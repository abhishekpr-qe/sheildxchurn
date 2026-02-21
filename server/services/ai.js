const { CFG, getIntervention, RISK_CACHE_TTL } = require('../config');
const { data, userIndex, sentimentCache, riskAnalysisCache } = require('./cache');
const { evaluateRules } = require('./rules');
const { callGemini, callViaOpenRouter } = require('./gemini');
const { recordCost } = require('./llm-cost');
const { createLogger } = require('../lib/logger');
const log = createLogger('ai');

// Edge case boundary — users near MEDIUM/LOW threshold need deeper analysis
const EDGE_MIN = 0.38;
const EDGE_MAX = 0.42;

/**
 * Build rule-based risk analysis fallback.
 * UNCHANGED from original — backward compatible.
 */
function buildFallback(user, intervention, source, confidence) {
  return {
    risk_signals: (user.reasons || []).map(r => ({
      signal: r.description,
      severity: user.risk_tier === 'CRITICAL' ? 'critical' : user.risk_tier === 'HIGH' ? 'high' : 'medium',
      evidence: `Score contribution: ${r.weight || 'significant'}`,
    })),
    intervention_plan: {
      primary: { action: intervention.message, channel: intervention.channel.split('+')[0].trim(), timing: 'Within 24h', message_template: intervention.message },
      secondary: { action: 'Follow-up if no response', channel: 'Email', timing: 'Day 3', message_template: `Reminder: ${intervention.message}` },
      tertiary: { action: 'Escalate channel', channel: 'WhatsApp', timing: 'Day 7', message_template: 'Can we help with your next transfer?' },
    },
    justification: `${source} analysis: ${user.risk_tier} risk user with ${((user.churn_probability || user.risk_score) * 100).toFixed(0)}% churn probability. Primary driver: ${user.reasons?.[0]?.description || 'inactivity'}.`,
    urgency: user.risk_tier === 'CRITICAL' ? 'immediate' : user.risk_tier === 'HIGH' ? 'this_week' : 'this_month',
    confidence,
    source,
  };
}

/**
 * Build enriched analysis from rule engine output (T2).
 */
function buildFromRules(user, intervention, ruleResult) {
  const signals = ruleResult.signals.length > 0
    ? ruleResult.signals.map(s => ({ signal: s.description, severity: s.severity, evidence: `Rule ${s.rule_id}, weight ${s.weight}` }))
    : (user.reasons || []).map(r => ({ signal: r.description, severity: 'medium', evidence: `Score: ${r.weight || 'significant'}` }));

  return {
    risk_signals: signals,
    intervention_plan: {
      primary: { action: intervention.message, channel: intervention.channel.split('+')[0].trim(), timing: 'Within 24h', message_template: intervention.message },
      secondary: { action: 'Follow-up if no response', channel: 'Email', timing: 'Day 3', message_template: `Reminder: ${intervention.message}` },
      tertiary: { action: 'Escalate channel', channel: 'WhatsApp', timing: 'Day 7', message_template: 'Can we help with your next transfer?' },
    },
    justification: `Rule engine: ${ruleResult.signals.length} signals matched (weight ${ruleResult.totalWeight.toFixed(2)}). ${user.risk_tier} risk, ${((user.churn_probability || user.risk_score) * 100).toFixed(0)}% churn probability.`,
    urgency: user.risk_tier === 'CRITICAL' ? 'immediate' : user.risk_tier === 'HIGH' ? 'this_week' : 'this_month',
    confidence: Math.min(0.60 + ruleResult.totalWeight * 0.3, 0.85),
    source: 'rule_engine',
    tier: 'T2',
    cost: 0,
  };
}

function determineTier(score, riskTier) {
  if (score >= EDGE_MIN && score <= EDGE_MAX) return 'T6';
  if (riskTier === 'CRITICAL' || riskTier === 'HIGH') return 'T5';
  return 'T2';
}

function buildEnrichmentPrompt(user, ruleResult) {
  const signalSummary = ruleResult.signals.map(s => `- ${s.description} (${s.severity})`).join('\n');
  return `Analyze this high-risk remittance user. Return ONLY valid JSON.

USER: ${user.corridor} corridor, ${user.tenure_days}d tenure, ${user.total_txns} txns (${user.completed_txns || 0} completed, ${user.failed_txns || 0} failed)
Score: ${((user.churn_probability || user.risk_score) * 100).toFixed(1)}% churn, ${user.risk_tier} tier
Inactive: ${user.days_since_last} days, Fail rate: ${((user.fail_rate || 0) * 100).toFixed(1)}%

DETECTED SIGNALS:
${signalSummary || 'None detected'}

Return: {"risk_signals":[{"signal":"...","severity":"critical|high|medium","evidence":"..."}],"intervention_plan":{"primary":{"action":"...","channel":"Phone|SMS|Email|Push|WhatsApp","timing":"...","message_template":"..."},"secondary":{"action":"...","channel":"...","timing":"...","message_template":"..."},"tertiary":{"action":"...","channel":"...","timing":"...","message_template":"..."}},"justification":"2-3 sentences","urgency":"immediate|this_week|this_month","confidence":0.0}`;
}

/**
 * T5: Gemini Flash enrichment for CRITICAL/HIGH users.
 * Falls back to rule engine if Gemini disabled/fails.
 */
async function runGeminiEnrichment(user, intervention, ruleResult, { reqId } = {}) {
  const prompt = buildEnrichmentPrompt(user, ruleResult);
  try {
    const result = await callGemini(prompt, { reqId, maxTokens: 500 });
    if (!result) return buildFromRules(user, intervention, ruleResult);

    recordCost('gemini-flash', result.tokens.input, result.tokens.output, result.cost, 'T5', { reqId, userId: user.user_id });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return buildFromRules(user, intervention, ruleResult);

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.risk_signals) return buildFromRules(user, intervention, ruleResult);

    return { ...parsed, source: 'gemini_flash', tier: 'T5', cost: result.cost };
  } catch (e) {
    log.warn('Gemini enrichment fallback', { userId: user.user_id, error: e.message?.slice(0, 80) });
    return buildFromRules(user, intervention, ruleResult);
  }
}

/**
 * T6: Haiku analysis for edge-case scores (0.38-0.42).
 * Tries direct Anthropic API, falls back to OpenRouter, then rule engine.
 */
async function runHaikuEdgeCase(user, intervention, ruleResult, { reqId } = {}) {
  const shapUser = (data.shap_data?.user_shap || []).find(s => s.user_id === user.user_id);
  const sentiment = sentimentCache[user.user_id] || null;

  const prompt = `You are a churn risk analyst for Aspora, a cross-border remittance platform (UK/UAE/USA → India).
Analyze this user and return ONLY valid JSON (no markdown, no explanation outside JSON).

USER DATA:
- Corridor: ${user.corridor}
- Tenure: ${user.tenure_days} days
- Transactions: ${user.total_txns} total (${user.completed_txns || 0} completed, ${user.failed_txns || 0} failed)
- Volume: ${user.total_volume} ${user.currency || ''}
- Fail rate: ${((user.fail_rate || 0) * 100).toFixed(1)}%
- Avg delivery: ${user.avg_delivery_min || 'N/A'} min
- Stuck rate: ${((user.stuck_rate || 0) * 100).toFixed(1)}%
- Days inactive: ${user.days_since_last}
- ML churn probability: ${((user.churn_probability || user.risk_score) * 100).toFixed(1)}%
- Risk tier: ${user.risk_tier}
- SHAP drivers: ${shapUser?.drivers?.map(d => `${d.feature}: ${d.impact}`).join(', ') || 'N/A'}
- Rule-based reasons: ${user.reasons?.map(r => r.description).join('; ') || 'N/A'}
${sentiment?.has_conversations ? `- Support sentiment: ${sentiment.sentiment}, pain points: ${sentiment.pain_points?.join(', ') || 'none'}, churn signal: ${sentiment.churn_signal}` : ''}

Return this exact JSON structure:
{"risk_signals": [{"signal": "...", "severity": "critical|high|medium|low", "evidence": "..."}],
"intervention_plan": {"primary": {"action": "...", "channel": "Phone|SMS|Email|Push|WhatsApp", "timing": "...", "message_template": "..."}, "secondary": {"action": "...", "channel": "...", "timing": "...", "message_template": "..."}, "tertiary": {"action": "...", "channel": "...", "timing": "...", "message_template": "..."}},
"justification": "2-3 sentence explanation",
"urgency": "immediate|this_week|this_month",
"confidence": 0.0-1.0}`;

  // Try direct Anthropic API
  if (CFG.AI_KEY) {
    const result = await callHaikuDirect(user, prompt, reqId);
    if (result) return result;
  }

  // Fallback: OpenRouter with Haiku model
  if (CFG.OPENROUTER_KEY) {
    const rlog = reqId ? createLogger('ai', { req_id: reqId }) : log;
    const result = await callViaOpenRouter(prompt, 'anthropic/claude-3.5-haiku', 800, rlog);
    if (result) {
      const text = result.text;
      recordCost('haiku-openrouter', result.tokens.input, result.tokens.output, result.cost, 'T6', { reqId, userId: user.user_id });
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const analysis = JSON.parse(jsonMatch[0]);
          if (analysis.risk_signals) return { ...analysis, source: 'haiku_edge', tier: 'T6', cost: result.cost };
        } catch (_) { /* parse failed, fall through */ }
      }
    }
  }

  return buildFromRules(user, intervention, ruleResult);
}

async function callHaikuDirect(user, prompt, reqId) {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.AI_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      log.warn('Haiku direct error', { userId: user.user_id, status: resp.status, body: body.slice(0, 200) });
      return null;
    }
    const d = await resp.json();
    const text = d.content?.[0]?.text || '';
    const inputTokens = d.usage?.input_tokens || 0;
    const outputTokens = d.usage?.output_tokens || 0;
    const cost = (inputTokens * 0.80 + outputTokens * 4.00) / 1_000_000;

    recordCost('haiku', inputTokens, outputTokens, cost, 'T6', { reqId, userId: user.user_id });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const analysis = JSON.parse(jsonMatch[0]);
    if (!analysis.risk_signals) return null;

    return { ...analysis, source: 'haiku_edge', tier: 'T6', cost };
  } catch (e) {
    log.warn('Haiku direct failed', { userId: user.user_id, error: e.message?.slice(0, 80) });
    return null;
  }
}

/**
 * Tiered risk analysis: T2 (rules) → T5 (Gemini) → T6 (Haiku).
 * Replaces the flat LLM-for-all approach.
 */
async function runRiskAnalysis(userId, { reqId } = {}) {
  const rlog = reqId ? createLogger('ai', { req_id: reqId }) : log;
  const cached = riskAnalysisCache[userId];
  if (cached && Date.now() - cached._ts < RISK_CACHE_TTL) return cached;

  const user = userIndex[userId];
  if (!user) return null;

  const intervention = user.intervention || getIntervention(user);
  const score = user.churn_probability || user.risk_score || 0;

  // T2: Rule engine always runs ($0)
  const ruleResult = evaluateRules(user);
  const tier = determineTier(score, user.risk_tier);

  let analysis;
  switch (tier) {
    case 'T5':
      analysis = await runGeminiEnrichment(user, intervention, ruleResult, { reqId });
      break;
    case 'T6':
      analysis = await runHaikuEdgeCase(user, intervention, ruleResult, { reqId });
      break;
    default:
      analysis = buildFromRules(user, intervention, ruleResult);
  }

  analysis._ts = Date.now();
  riskAnalysisCache[userId] = analysis;
  return analysis;
}

function fallbackBrief(u) {
  let brief = `${u.corridor} user, ${u.tenure_days}d tenure, ${u.completed_txns} completed transfers. `;
  brief += `ML churn probability: ${((u.churn_probability || u.risk_score) * 100).toFixed(0)}%.`;
  if (u.days_since_last > 60) brief += ` Inactive for ${u.days_since_last} days.`;
  if (u.fail_rate > 0.15) brief += ` High failure rate: ${(u.fail_rate * 100).toFixed(0)}%.`;
  const intervention = u.intervention || getIntervention(u);
  brief += ` Recommended: ${intervention.message}`;
  return brief;
}

function fallbackChat(message) {
  const m = message.toLowerCase();
  if (m.includes('model') || m.includes('auc'))
    return `Model: ${data.model?.type || 'LightGBM'} | AUC: ${data.model?.metrics?.validation?.auc || 0.945} | ${data.model?.train_samples || 'N/A'} training samples. Top features: stuck_rate, delivery speed, completion rate, days_since_last.`;
  if (m.includes('churn') || m.includes('rate'))
    return `Overall churn rate: ${(data.churn_overview.churn_rate * 100).toFixed(1)}%. ` + Object.entries(data.corridor_analysis).map(([n, i]) => `${n}: ${(i.churn_rate * 100).toFixed(1)}%`).join(', ');
  if (m.includes('corridor'))
    return Object.entries(data.corridor_analysis).map(([n, i]) => `${n}: ${(i.churn_rate * 100).toFixed(1)}% churn, ${i.total} users (${i.churned} churned)`).join('\n');
  if (m.includes('intervention') || m.includes('action'))
    return Object.entries(data.interventions).map(([type, info]) => `${type}: ${info.count} users, $${Math.round(info.cost)} cost`).join('\n');
  return `${data.summary.total_users.toLocaleString()} users scored. ${data.backtest.detection_p0p1 * 100}% detection. CRITICAL: ${data.churn_overview.tiers.CRITICAL}, HIGH: ${data.churn_overview.tiers.HIGH}.`;
}

module.exports = { runRiskAnalysis, fallbackBrief, fallbackChat, buildFallback };
