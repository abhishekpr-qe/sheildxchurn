const { CFG, MIXPANEL_FUNNELS } = require('../config');
const { data, userIndex, liveData, mixpanelData, sentimentCache } = require('../services/cache');
const { sanitizeId } = require('../lib/validate');
const { decagonData, analyzeSentiment, ruleBasedSentiment, NEGATIVE_WORDS } = require('../services/sentiment');
const { runRiskAnalysis, fallbackBrief, fallbackChat } = require('../services/ai');
const { mixpanelAuth } = require('../services/mixpanel');
const { getIntervention } = require('../config');
const { createLogger } = require('../lib/logger');
const log = createLogger('ai-routes');

/**
 * Build system context for AI chat from platform data.
 * @param {Object} data - Global data store
 * @param {Object} liveData - Live data cache
 * @returns {string} System prompt string
 */
function buildChatContext(data, liveData) {
  const corridorInfo = Object.entries(data.corridor_analysis)
    .map(([name, info]) => `${name}: ${(info.churn_rate * 100).toFixed(1)}% churn (${info.total} users)`)
    .join(', ');
  const tierInfo = Object.entries(data.churn_overview.tiers).map(([t, c]) => `${t}=${c}`).join(' ');
  const interventionInfo = Object.entries(data.interventions)
    .map(([type, info]) => `${type}: ${info.count} users ($${Math.round(info.cost)})`).join(', ');

  let liveContext = '';
  if (liveData.early_warnings?.row_count) {
    liveContext += `\n\n=== Live Early Warnings (${liveData.last_refresh}) ===\n`;
    liveContext += `${liveData.early_warnings.row_count} users with active risk signals from Metabase\n`;
    const topWarnings = liveData.early_warnings.rows.slice(0, 5);
    topWarnings.forEach(w => {
      liveContext += `  ${w.user_id?.slice(0,12)}: ${w.corridor}, ${w.total_risk_signals} signals, inactive ${w.days_since_last}d\n`;
    });
  }
  if (liveData.corridor_health?.rows?.length) {
    liveContext += '\n=== Live Corridor Health ===\n';
    liveData.corridor_health.rows.forEach(c => {
      liveContext += `  ${c.corridor}: ${c.total_users} users, ${c.active_30d} active, ${c.success_rate_30d}% success, ${c.avg_delivery_min_30d}min avg\n`;
    });
  }
  if (liveData.partner_performance?.rows?.length) {
    liveContext += '\n=== Partner Performance ===\n';
    liveData.partner_performance.rows.slice(0, 5).forEach(p => {
      liveContext += `  ${p.partner} (${p.corridor}): ${p.failure_rate_pct}% fail, ${p.avg_delivery_min}min avg\n`;
    });
  }

  return [
    'You are the Aspora Churn Intelligence AI assistant.',
    'You help retention teams understand churn patterns, model performance, and intervention strategies.',
    '',
    '=== Platform Context ===',
    `Model: ${data.model?.type || 'LightGBM'} ensemble | AUC: ${data.model?.metrics?.validation?.auc || 0.945}`,
    `Total Users: ${data.summary.total_users} | Total Txns: ${data.summary.total_txns}`,
    `Churn Rate: ${(data.churn_overview.churn_rate * 100).toFixed(1)}%`,
    `Risk Tiers: ${tierInfo}`,
    `Corridors: ${corridorInfo}`,
    `Interventions: ${interventionInfo}`,
    '',
    '=== Intervention Types ===',
    'support_callback (Phone+SMS, $3.50, 18-22% lift) — for failure/error issues',
    'speed_guarantee (WhatsApp+Email, $1.20, 12-16% lift) — for slow delivery',
    'loyalty_discount (Email+In-app, $2.00, 14-18% lift) — for pricing sensitivity',
    'priority_queue (SMS+In-app, $0.50, 10-14% lift) — for stuck transactions',
    're_engagement (Email+Push, $0.15, 6-9% lift) — for inactivity/low engagement',
    liveContext,
    'Be concise, data-driven, and actionable. Reference specific numbers.',
  ].join('\n');
}

module.exports = function(app) {

  app.get('/api/users/:id/sentiment', async (req, res) => {
    const userId = sanitizeId(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID format' });
    // Allow sentiment for both ML-scored users and Decagon-only users
    const hasDecagon = !!decagonData[userId];
    const hasModel = !!userIndex[userId];
    if (!hasDecagon && !hasModel) return res.status(404).json({ error: 'User not found' });

    try {
      const sentiment = await analyzeSentiment(userId, { reqId: req.id });
      res.json(sentiment);
    } catch (e) {
      res.status(500).json({ error: 'Sentiment analysis failed', detail: e.message });
    }
  });

  // Bulk sentiment for all users (for Risk Explorer)
  app.get('/api/sentiment/summary', async (req, res) => {
    const summary = {};

    // Include demo sentiment data
    const userSentiment = data.user_sentiment || {};
    for (const [userId, s] of Object.entries(userSentiment)) {
      summary[userId] = {
        sentiment: s.sentiment,
        pain_points_count: (s.pain_points || []).length,
        churn_signal: s.churn_signal,
        urgency: s.urgency,
        has_conversations: s.has_conversations,
      };
    }

    // Include real Decagon CSV users (overrides demo if same user)
    for (const userId of Object.keys(decagonData)) {
      if (!sentimentCache[userId]) {
        const convs = decagonData[userId];
        const result = ruleBasedSentiment(userId, convs);
        summary[userId] = {
          sentiment: result.sentiment,
          pain_points_count: (result.pain_points || []).length,
          churn_signal: result.churn_signal,
          urgency: result.urgency,
          has_conversations: true,
          source: 'decagon_csv',
          conversation_count: convs.length,
          country: convs[0]?.meta_country || '',
        };
      } else {
        const cached = sentimentCache[userId];
        summary[userId] = {
          sentiment: cached.sentiment,
          pain_points_count: (cached.pain_points || []).length,
          churn_signal: cached.churn_signal,
          urgency: cached.urgency,
          has_conversations: cached.has_conversations,
          source: 'decagon_csv',
        };
      }
    }

    res.json(summary);
  });

  // GET /api/decagon — Browse all real Decagon conversations
  app.get('/api/decagon', (req, res) => {
    const userCount = Object.keys(decagonData).length;
    const totalConvs = Object.values(decagonData).reduce((s, c) => s + c.length, 0);
    const countries = {};
    const destinations = {};
    for (const convs of Object.values(decagonData)) {
      for (const c of convs) {
        const country = c.meta_country || 'unknown';
        countries[country] = (countries[country] || 0) + 1;
        const dest = c.destination || 'unknown';
        destinations[dest] = (destinations[dest] || 0) + 1;
      }
    }
    const withSummary = Object.values(decagonData).flat().filter(c => c.summary && !c.summary.startsWith('User wrote:')).length;

    res.json({
      source: 'csv',
      unique_users: userCount,
      total_conversations: totalConvs,
      with_summary: withSummary,
      countries,
      destinations,
      users: Object.entries(decagonData).slice(0, 50).map(([uid, convs]) => ({
        user_id: uid,
        conversation_count: convs.length,
        country: convs[0]?.meta_country || '',
        name: `${convs[0]?.meta_first_name || ''} ${convs[0]?.meta_last_name || ''}`.trim(),
        last_interaction: convs[0]?.created_at || '',
        latest_summary: convs[0]?.summary?.slice(0, 200) || '',
        has_order: !!convs[0]?.meta_order_id,
      })),
    });
  });

  app.post('/api/ai/brief', async (req, res) => {
    const user = userIndex[req.body.user_id];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!CFG.AI_KEY) return res.json({ brief: fallbackBrief(user) });

    try {
      const intervention = user.intervention || getIntervention(user);
      const prompt = [
        'You are a retention analyst at Aspora (cross-border remittance platform).',
        'Write a 3-4 sentence brief about this at-risk user. Be specific with numbers.',
        'End with a concrete intervention recommendation.',
        '',
        `Corridor: ${user.corridor}`,
        `Tenure: ${user.tenure_days} days`,
        `Transactions: ${user.total_txns} total (${user.completed_txns} completed, ${user.failed_txns} failed)`,
        `Volume: ${user.total_volume} ${user.currency}`,
        `Inactive: ${user.days_since_last} days`,
        `Failure Rate: ${(user.fail_rate * 100).toFixed(1)}%`,
        `Avg Delivery: ${user.avg_delivery_min} min`,
        `Stuck Rate: ${(user.stuck_rate * 100).toFixed(1)}%`,
        `ML Churn Probability: ${((user.churn_probability || user.risk_score) * 100).toFixed(1)}%`,
        `Risk Tier: ${user.risk_tier}`,
        `Risk Reasons: ${user.reasons.map(r => r.description).join('; ')}`,
        `Recommended Intervention: ${intervention.type} via ${intervention.channel}`,
      ].join('\n');

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.AI_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
      });
      const d = await resp.json();
      res.json({ brief: d.content?.[0]?.text || fallbackBrief(user) });
    } catch (e) {
      log.error('AI brief error', { error: e.message });
      res.json({ brief: fallbackBrief(user) });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    const message = req.body.message;
    if (!CFG.AI_KEY) return res.json({ response: fallbackChat(message) });

    const systemPrompt = buildChatContext(data, liveData);
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.AI_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, system: systemPrompt, messages: [{ role: 'user', content: message }] }),
      });
      const d = await resp.json();
      res.json({ response: d.content?.[0]?.text || 'No response generated.' });
    } catch (e) {
      log.error('AI chat error', { error: e.message });
      res.json({ response: fallbackChat(message) });
    }
  });

  app.post('/api/ai/risk-analysis', async (req, res) => {
    const { user_id, user_ids } = req.body;
    const rawIds = user_ids || (user_id ? [user_id] : []);
    const ids = rawIds.map(id => sanitizeId(id)).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'Provide user_id or user_ids' });
    if (ids.length > 20) return res.status(400).json({ error: 'Max 20 users per batch' });

    const results = {};
    for (const uid of ids) {
      const analysis = await runRiskAnalysis(uid, { reqId: req.id });
      if (analysis) {
        const { _ts, ...clean } = analysis;
        results[uid] = clean;
      } else {
        results[uid] = { error: 'User not found' };
      }
    }

    res.json({ analyses: results, count: ids.length, timestamp: new Date().toISOString() });
  });

  app.post('/api/mixpanel/funnel', async (req, res) => {
    const { funnel_id, from_date, to_date } = req.body;
    if (!CFG.MIXPANEL_SECRET) {
      return res.json({ mock: true, message: 'Mixpanel not configured.', funnel: [
        { step: 'App Install', count: 120000, pct: 100 }, { step: 'Signup', count: 89000, pct: 74.2 },
        { step: 'KYC Start', count: 72000, pct: 60.0 }, { step: 'KYC Upload', count: 61000, pct: 50.8 },
        { step: 'KYC Verified', count: 55000, pct: 45.8 }, { step: '1st Transfer Init', count: 48000, pct: 40.0 },
        { step: '1st Transfer Done', count: 42000, pct: 35.0 }, { step: '2nd Transfer', count: 31000, pct: 25.8 },
        { step: 'Regular (5+)', count: 22000, pct: 18.3 },
      ] });
    }
    try {
      const authToken = Buffer.from(`${CFG.MIXPANEL_SECRET}:`).toString('base64');
      const params = new URLSearchParams({ funnel_id: funnel_id || '1', from_date: from_date || '2025-10-01', to_date: to_date || '2026-02-20' });
      const resp = await fetch(`https://mixpanel.com/api/2.0/funnels?${params}`, { headers: { 'Authorization': `Basic ${authToken}` } });
      const result = await resp.json();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'Mixpanel query failed', detail: e.message });
    }
  });

  // Mixpanel overview — cached funnels + engage stats
  app.get('/api/mixpanel/overview', (req, res) => {
    if (!mixpanelData.last_refresh) {
      return res.json({ status: 'loading', message: 'Mixpanel data is being fetched...' });
    }
    res.json({
      funnels: mixpanelData.funnels,
      engage_stats: mixpanelData.engage_stats,
      last_refresh: mixpanelData.last_refresh,
      daily_snapshot: {
        date: '2026-02-20',
        total_events: 2295011,
        daily_active_users: 77599,
        orders_created: 23671,
        orders_completed: 15307,
        orders_failed: 6638,
        sessions: 159625,
        api_errors: 2581,
        api_timeouts: 2609,
        kyc_updated: 3761,
        users_signed_up: 1198,
        users_created: 1100,
        help_screens: 4954,
        chat_clicks: 1493,
        transfer_screens: 116468,
        review_screens: 45189,
      },
    });
  });

  // List available funnels
  app.get('/api/mixpanel/funnels', (req, res) => {
    res.json({
      available: MIXPANEL_FUNNELS,
      cached: Object.keys(mixpanelData.funnels),
      last_refresh: mixpanelData.last_refresh,
    });
  });

};
