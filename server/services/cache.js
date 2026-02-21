const { createLogger } = require('../lib/logger');
const { loadAllCsvData } = require('./csv-loader');
const log = createLogger('cache');

// Load CSV seed data (immediate dashboard data while Redshift is slow)
const csv = loadAllCsvData();

// Dashboard data — seeded from CSV, overridden by Redshift when available
let data = {
  summary: csv.summary || { total_users: 0, active_30d: 0, data_source: 'redshift' },
  model: { type: 'Ensemble', metrics: {} },
  churn_overview: csv.churnOverview || {
    status: { CHURNED: 0, ACTIVE: 0, AT_RISK: 0, HEALTHY: 0 },
    tiers: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  },
  corridor_analysis: csv.corridorAnalysis || {},
  interventions: {},
  backtest: { total_churned: 0, accuracy: 0, detection_p0p1: 0 },
  reason_frequency: {},
  transaction_status: csv.transactionStatus || { COMPLETED: 0, FAILED: 0, STUCK: 0, PROCESSING: 0, PENDING: 0 },
  at_risk_users: csv.atRiskUsers || [],
  churned_sample: [],
  healthy_sample: [],
  executive_impact: csv.executiveImpact || {
    total_users: 0, active_30d: 0, churn_rate_baseline: 0,
    churn_rate_post_intervention: 0, predicted_churn_30d: 0,
    retained_saved: 0, monthly_net_benefit: 0, roi_multiple: 0,
    payback_days: 0, total_intervention_cost: 0,
  },
  shap_data: {},
  experiments: {},
  rollout: csv.rollout || null,
};

// User index (lookup by user_id) — populated from Redshift early_warnings
// Mutate in place so destructured imports in routes stay valid
const userIndex = {};
function rebuildUserIndex() {
  Object.keys(userIndex).forEach(k => delete userIndex[k]);
  const source = [
    ...(data.at_risk_users  || []),
    ...(data.churned_sample || []),
    ...(data.healthy_sample || []),
  ];
  source.forEach(u => {
    if (!userIndex[u.user_id]) userIndex[u.user_id] = u;
  });
  log.info('User index rebuilt', { count: Object.keys(userIndex).length });
}

/**
 * Populate data.at_risk_users from liveData.early_warnings rows
 * and rebuild userIndex. Called after Redshift refresh completes.
 */
function rebuildFromLiveData() {
  if (!liveData.early_warnings?.rows?.length) return;

  data.at_risk_users = liveData.early_warnings.rows.map(r => {
    const corridor = r.corridor === 'UAE' ? 'UAE → India'
      : r.corridor === 'UK' ? 'UK → India'
      : r.corridor === 'US' ? 'US → India' : 'Other';
    const totalTxns = Number(r.total_txns) || 0;
    const failed = Number(r.failed) || 0;
    const riskSignals = Number(r.total_risk_signals) || 0;
    return {
      user_id: r.user_id,
      corridor,
      currency: r.currency_from,
      tenure_days: Number(r.tenure_days) || 0,
      total_txns: totalTxns,
      completed_txns: Number(r.completed) || 0,
      failed_txns: failed,
      total_volume: Number(r.total_volume) || 0,
      days_since_last: Number(r.days_since_last) || 0,
      fail_rate: totalTxns > 0 ? Math.round(failed / totalTxns * 10000) / 10000 : 0,
      risk_signals: riskSignals,
      risk_score: Math.min(0.5 + riskSignals * 0.1, 0.99),
      churn_probability: Math.min(0.5 + riskSignals * 0.1, 0.99),
      risk_tier: riskSignals >= 4 ? 'CRITICAL' : riskSignals >= 3 ? 'HIGH' : riskSignals >= 2 ? 'MEDIUM' : 'LOW',
      reasons: buildReasons(r),
      source: 'redshift_live',
    };
  });

  rebuildUserIndex();
}

function buildReasons(r) {
  const reasons = [];
  if (r.signal_high_failures) reasons.push({ code: 'failure_rate', description: 'High transaction failure rate' });
  if (r.signal_slow_delivery) reasons.push({ code: 'slow_delivery', description: 'Slow delivery times' });
  if (r.signal_stuck_now) reasons.push({ code: 'stuck_transaction', description: 'Currently stuck transfer' });
  if (r.signal_frequency_drop) reasons.push({ code: 'frequency_decline', description: 'Transaction frequency declining' });
  if (r.signal_volume_drop) reasons.push({ code: 'volume_decline', description: 'Transfer volume declining' });
  if (r.signal_going_inactive) reasons.push({ code: 'inactivity', description: 'Going inactive' });
  if (!reasons.length) reasons.push({ code: 'inactivity', description: 'Reduced activity' });
  return reasons;
}
// Seed userIndex from CSV data (all users + at_risk)
const allCsvUsers = csv.allUsers || csv.atRiskUsers || [];
allCsvUsers.forEach(u => {
  if (u.user_id && !userIndex[u.user_id]) userIndex[u.user_id] = u;
});
// Also add at_risk users not already in the index
(csv.atRiskUsers || []).forEach(u => {
  if (u.user_id && !userIndex[u.user_id]) userIndex[u.user_id] = u;
});
log.info('Cache initialized from CSV seed', { users: Object.keys(userIndex).length, at_risk: (csv.atRiskUsers || []).length });

// Live data cache (Redshift-powered)
const liveData = {
  early_warnings:      null,
  corridor_health:     null,
  monthly_trends:      null,
  partner_performance: null,
  new_user_cohorts:    null,
  delivery:            null,
  pricing:             null,
  prediction_validation: null,
  decagon_conversations: null,
  backtest:              null,
  last_refresh:        null,
  refresh_status:      {},
};

// Mixpanel live data cache — seeded from CSV snapshot
const mixpanelData = {
  funnels: {},
  engage_stats: null,
  event_counts: null,
  last_refresh: csv.mixpanelSnapshot ? new Date().toISOString() : null,
  daily_snapshot: csv.mixpanelSnapshot || null,
};

// Sentiment cache (per-user, AI-analyzed)
const sentimentCache = {};

// Risk analysis cache (5-min TTL)
const riskAnalysisCache = {};

// Transaction index (lookup by user_id → array of txns)
const transactionIndex = {};
(csv.transactions || []).forEach(t => {
  if (!t.user_id) return;
  if (!transactionIndex[t.user_id]) transactionIndex[t.user_id] = [];
  transactionIndex[t.user_id].push(t);
});
log.info('Transaction index built', { users: Object.keys(transactionIndex).length, txns: (csv.transactions || []).length });

// Campaign audit log (in-memory + S3)
const campaignLog = [];

// Intervention log (in-memory)
const interventionLog = [];

module.exports = {
  data,
  userIndex,
  transactionIndex,
  rebuildUserIndex,
  rebuildFromLiveData,
  liveData,
  mixpanelData,
  sentimentCache,
  riskAnalysisCache,
  campaignLog,
  interventionLog,
};
