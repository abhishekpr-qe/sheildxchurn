const { CFG, getIntervention } = require('../config');
const { data, userIndex, riskAnalysisCache } = require('../services/cache');
const { sanitizeId } = require('../lib/validate');
const { analyzeSentiment } = require('../services/sentiment');
const { runRiskAnalysis, fallbackBrief } = require('../services/ai');
const { liveData } = require('../services/cache');
const { createLogger } = require('../lib/logger');
const log = createLogger('dossier');

/**
 * Build base dossier fields from user data.
 * @param {string} userId - User ID
 * @param {Object} user - User object from userIndex
 * @param {Object} data - Global data store
 * @returns {Object} Base dossier fields
 */
function buildDossierBase(userId, user, data) {
  const intervention = user.intervention || getIntervention(user);
  const timeline = (data.user_timelines || {})[userId] || null;
  const shapUser = (data.shap_data?.user_shap || []).find(s => s.user_id === userId);
  const cohort = (data.cohorts || []).find(c =>
    (c.sample_users || []).some(u => u.user_id === userId)
  );

  const nudge_sequence = [
    { day: 0, action: `Send ${intervention.channel.split('+')[0].trim().toLowerCase()}`, channel: intervention.channel.split('+')[0].trim(), message: intervention.message },
    { day: 3, action: 'Follow-up if no response', channel: 'Email', message: `Reminder: ${intervention.message}` },
    { day: 7, action: 'Escalate channel', channel: 'WhatsApp', message: 'We noticed you haven\'t completed a transfer recently. Can we help?' },
  ];
  if (user.risk_tier === 'CRITICAL') {
    nudge_sequence.push({ day: 10, action: 'AI phone call', channel: 'Phone', message: 'Priority retention call' });
  }

  return {
    user_id: userId,
    generated_at: new Date().toISOString(),
    risk_tier: user.risk_tier,
    churn_probability: user.churn_probability || user.risk_score,
    confidence: user.risk_tier === 'CRITICAL' ? 0.92 : user.risk_tier === 'HIGH' ? 0.85 : 0.78,
    corridor: user.corridor,
    tenure_days: user.tenure_days,
    total_txns: user.total_txns,
    total_volume: user.total_volume,
    days_inactive: user.days_since_last,
    churn_reasons: user.reasons,
    shap_drivers: shapUser?.drivers || [],
    cohort: cohort ? { key: cohort.key, label: cohort.label } : null,
    recommended_intervention: intervention,
    nudge_sequence,
    expected_uplift: intervention.lift,
    owner: user.risk_tier === 'CRITICAL' ? 'retention_lead' : 'retention_team',
    timeline,
  };
}

/**
 * Enrich dossier with AI-generated summary.
 * @param {Object} dossier - Dossier to enrich
 * @param {Object} user - User object
 * @param {Object|null} sentiment - Sentiment data
 */
async function enrichWithAISummary(dossier, user, sentiment, { reqId } = {}) {
  if (!CFG.AI_KEY) return;
  try {
    const sentimentCtx = sentiment?.has_conversations ? `\nLast support interaction sentiment: ${sentiment.sentiment}. Pain points: ${sentiment.pain_points.join(', ') || 'none'}. Churn signal from support: ${sentiment.churn_signal}.` : '';
    const prompt = `Generate a 4-5 sentence recovery dossier for this at-risk remittance user. Include: why they're churning, what to do, expected outcome. If there are support pain points, address them specifically.\n\nUser: ${user.corridor}, ${user.tenure_days}d tenure, ${user.total_txns} txns, inactive ${user.days_since_last}d, ${user.risk_tier} risk (${((user.churn_probability||user.risk_score)*100).toFixed(0)}%), reasons: ${user.reasons.map(r=>r.description).join('; ')}${sentimentCtx}`;
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.AI_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await resp.json();
    dossier.ai_summary = d.content?.[0]?.text || null;
  } catch (e) { log.warn('AI summary unavailable', { userId: dossier.user_id, error: e.message }); }
}

/**
 * Enrich dossier with LLM risk analysis.
 * @param {Object} dossier - Dossier to enrich
 * @param {string} userId - User ID
 */
async function enrichWithRiskAnalysis(dossier, userId, { reqId } = {}) {
  try {
    const riskAnalysis = await runRiskAnalysis(userId, { reqId });
    if (riskAnalysis) {
      const { _ts, ...clean } = riskAnalysis;
      dossier.llm_risk_signals = clean.risk_signals || null;
      dossier.llm_intervention_plan = clean.intervention_plan || null;
      dossier.llm_justification = clean.justification || null;
      dossier.llm_urgency = clean.urgency || null;
      dossier.llm_confidence = clean.confidence || null;
      dossier.llm_source = clean.source || null;
    }
  } catch (e) { log.warn('LLM risk analysis unavailable', { userId, error: e.message }); }
}

module.exports = function(app) {

  app.get('/api/users/:id/dossier', async (req, res) => {
    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user ID format' });
    const user = userIndex[id];
    if (!user) return res.status(404).json({ error: 'User not found' });

    let sentiment = null;
    try { sentiment = await analyzeSentiment(id, { reqId: req.id }); } catch (e) { log.warn('Sentiment unavailable', { userId: id, error: e.message }); }

    const dossier = buildDossierBase(id, user, data);
    dossier.sentiment = sentiment;

    await enrichWithAISummary(dossier, user, sentiment, { reqId: req.id });
    await enrichWithRiskAnalysis(dossier, id, { reqId: req.id });

    res.json(dossier);
  });

  app.post('/api/score/user', (req, res) => {
    const user_id = sanitizeId(req.body.user_id);
    if (!user_id) return res.status(400).json({ error: 'Invalid user ID format' });
    const user = userIndex[user_id];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      user_id,
      churn_probability: user.churn_probability || user.risk_score,
      risk_tier: user.risk_tier,
      reasons: user.reasons,
      intervention: user.intervention,
      scored_at: new Date().toISOString(),
    });
  });

  app.get('/api/executive', (req, res) => {
    const exec = Object.assign({}, data.executive_impact || {});
    // Merge live data if available
    if (liveData.corridor_health?.rows?.length) {
      let total = 0, active = 0;
      liveData.corridor_health.rows.forEach(r => { total += r.total_users; active += r.active_30d; });
      exec.total_users = total;
      exec.active_30d = active;
      exec.churn_rate_baseline = total > 0 ? Math.round((1 - active / total) * 10000) / 10000 : exec.churn_rate_baseline;
    }
    if (liveData.early_warnings?.rows?.length) {
      exec.predicted_churn_30d = liveData.early_warnings.row_count;
    }
    if (liveData.monthly_trends?.rows?.length) {
      const latest = liveData.monthly_trends.rows[liveData.monthly_trends.rows.length - 1];
      const prev = liveData.monthly_trends.rows[liveData.monthly_trends.rows.length - 2];
      if (latest && prev) {
        exec.monthly_volume = latest.total_volume;
        exec.monthly_txns = latest.total_txns;
        exec.volume_growth = prev.total_volume > 0 ? Math.round((latest.total_volume / prev.total_volume - 1) * 10000) / 10000 : 0;
      }
    }
    exec.data_source = liveData.last_refresh ? 'redshift_live' : 'static';
    res.json(exec);
  });

  app.get('/api/shap', (req, res) => {
    res.json(data.shap_data || {});
  });

  app.get('/api/experiments', (req, res) => {
    res.json(data.experiments || {});
  });

  app.get('/api/model/health', (req, res) => {
    res.json({
      model: data.model,
      backtest: data.backtest,
      health: data.model_health || {},
    });
  });

  app.get('/api/data/health', (req, res) => {
    res.json(data.data_health || {});
  });

  app.get('/api/compliance', (req, res) => {
    res.json(data.compliance || {});
  });

};
