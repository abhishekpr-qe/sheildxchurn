const fs = require('fs');
const path = require('path');
const { createLogger } = require('../lib/logger');
const log = createLogger('cache');

const ROOT = path.join(__dirname, '..', '..');

// Dashboard data (from JSON artifacts)
let data = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'churn_dashboard_data.json'), 'utf8')
);

// Merge real transaction data if available
const realTxnPath = path.join(ROOT, 'data', 'real_transactions.json');
let realData = null;
if (fs.existsSync(realTxnPath)) {
  realData = JSON.parse(fs.readFileSync(realTxnPath, 'utf8'));
  data.summary = realData.summary;
  data.churn_overview = realData.churn_overview;
  data.corridor_analysis = realData.corridor_analysis;
  data.interventions = realData.interventions;
  data.backtest = realData.backtest;
  data.reason_frequency = realData.reason_frequency;
  data.transaction_status = realData.transaction_status;
  data.model = { ...data.model, real_data: true, real_users: realData.summary.total_users, real_txns: realData.summary.total_txns };
  data.at_risk_users = realData.at_risk_users;
  data.churned_sample = realData.churned_sample;
  data.healthy_sample = realData.healthy_sample;
  if (realData.cohorts) data.cohorts = realData.cohorts;
  log.info('Real data loaded', { users: realData.summary.total_users, txns: realData.summary.total_txns });
}

// User index (lookup by user_id) — prefer all_users for full coverage
let userIndex = {};
function rebuildUserIndex() {
  userIndex = {};
  const source = realData?.all_users || [
    ...(data.at_risk_users  || []),
    ...(data.churned_sample || []),
    ...(data.healthy_sample || []),
  ];
  source.forEach(u => {
    if (!userIndex[u.user_id]) userIndex[u.user_id] = u;
  });
}
rebuildUserIndex();
log.info('User index built', { users: Object.keys(userIndex).length, model: data.model?.type || 'rules' });

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
  last_refresh:        null,
  refresh_status:      {},
};

// Mixpanel live data cache
const mixpanelData = {
  funnels: {},
  engage_stats: null,
  event_counts: null,
  last_refresh: null,
};

// Sentiment cache (per-user, AI-analyzed)
const sentimentCache = {};

// Risk analysis cache (5-min TTL)
const riskAnalysisCache = {};

// Campaign audit log (in-memory + S3)
const campaignLog = [];

// Intervention log (in-memory)
const interventionLog = [];

module.exports = {
  data,
  userIndex,
  rebuildUserIndex,
  liveData,
  mixpanelData,
  sentimentCache,
  riskAnalysisCache,
  campaignLog,
  interventionLog,
};
