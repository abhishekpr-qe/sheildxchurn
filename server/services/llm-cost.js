const { recordLlmUsage, queryLlmUsage } = require('./redshift');
const { createLogger } = require('../lib/logger');
const log = createLogger('llm-cost');

// In-memory cache (hot reads) — DB is source of truth
const recentCosts = [];
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h in-memory window

/**
 * Record an LLM call cost — writes to Redshift + in-memory cache.
 */
function recordCost(model, inputTokens, outputTokens, costUsd, tier, { reqId, userId } = {}) {
  const entry = { model, inputTokens, outputTokens, costUsd, tier, reqId: reqId || '', userId: userId || '', ts: Date.now() };

  recentCosts.push(entry);
  const cutoff = Date.now() - WINDOW_MS;
  while (recentCosts.length > 0 && recentCosts[0].ts < cutoff) recentCosts.shift();

  // Persist to DB (fire-and-forget, non-blocking)
  recordLlmUsage(entry).catch(e => log.warn('Cost persist failed', { error: e.message.slice(0, 60) }));
}

/**
 * Get cost summary — in-memory for last 24h, DB for historical.
 */
async function getCostSummary() {
  const now = Date.now();

  // Last 24h from memory (fast)
  const byTier24h = {};
  for (const e of recentCosts) {
    if (!byTier24h[e.tier]) byTier24h[e.tier] = { calls: 0, cost: 0, tokens: 0 };
    byTier24h[e.tier].calls++;
    byTier24h[e.tier].cost += e.costUsd;
    byTier24h[e.tier].tokens += e.inputTokens + e.outputTokens;
  }

  // Last 30d from DB
  let db30d = { rows: [], source: 'memory_only' };
  try {
    db30d = await queryLlmUsage(30);
  } catch (e) {
    log.warn('Cost query failed', { error: e.message.slice(0, 60) });
  }

  return {
    last_24h: { by_tier: byTier24h, total_calls: recentCosts.length, total_cost: recentCosts.reduce((s, e) => s + e.costUsd, 0) },
    last_30d: db30d,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { recordCost, getCostSummary };
