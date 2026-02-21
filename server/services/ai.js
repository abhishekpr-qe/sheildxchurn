const { CFG, getIntervention, RISK_CACHE_TTL } = require('../config');
const { data, userIndex, sentimentCache, riskAnalysisCache } = require('./cache');
const { createLogger } = require('../lib/logger');
const log = createLogger('ai');

/**
 * Build rule-based risk analysis fallback.
 * @param {Object} user - User object from userIndex
 * @param {Object} intervention - Resolved intervention for user
 * @param {string} source - Source label for the fallback
 * @param {number} confidence - Confidence score
 * @returns {Object} Risk analysis result
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

async function runRiskAnalysis(userId, { reqId } = {}) {
  const rlog = reqId ? createLogger('ai', { req_id: reqId }) : log;
  const cached = riskAnalysisCache[userId];
  if (cached && Date.now() - cached._ts < RISK_CACHE_TTL) return cached;

  const user = userIndex[userId];
  if (!user) return null;

  const intervention = user.intervention || getIntervention(user);
  const shapUser = (data.shap_data?.user_shap || []).find(s => s.user_id === userId);
  const sentiment = sentimentCache[userId] || null;

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
{
  "risk_signals": [{"signal": "...", "severity": "critical|high|medium|low", "evidence": "..."}],
  "intervention_plan": {
    "primary": {"action": "...", "channel": "Phone|SMS|Email|Push|WhatsApp", "timing": "...", "message_template": "..."},
    "secondary": {"action": "...", "channel": "...", "timing": "...", "message_template": "..."},
    "tertiary": {"action": "...", "channel": "...", "timing": "...", "message_template": "..."}
  },
  "justification": "2-3 sentence explanation",
  "urgency": "immediate|this_week|this_month",
  "confidence": 0.0-1.0
}`;

  if (!CFG.AI_KEY) {
    const fallback = buildFallback(user, intervention, 'rule_based', 0.7);
    fallback._ts = Date.now();
    riskAnalysisCache[userId] = fallback;
    return fallback;
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.AI_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await resp.json();
    const text = d.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let analysis = {};
    if (jsonMatch) {
      try { analysis = JSON.parse(jsonMatch[0]); } catch (e) { /* fallback below */ }
    }

    if (!analysis.risk_signals) {
      const fb = buildFallback(user, intervention, 'rule_based_parse_fallback', 0.6);
      fb._ts = Date.now();
      riskAnalysisCache[userId] = fb;
      return fb;
    }

    analysis.source = 'llm';
    analysis._ts = Date.now();
    riskAnalysisCache[userId] = analysis;
    return analysis;
  } catch (e) {
    rlog.error('Risk analysis LLM error', { userId, error: e.message });
    const fallback = buildFallback(user, intervention, 'rule_based_fallback', 0.65);
    fallback._ts = Date.now();
    riskAnalysisCache[userId] = fallback;
    return fallback;
  }
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
