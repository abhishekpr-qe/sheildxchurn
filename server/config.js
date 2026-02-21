require('dotenv').config();
const path = require('path');

// Shared constants from Python domain (single source of truth)
const DOMAIN = require(path.join(__dirname, 'constants.json'));

const CFG = {
  AI_KEY:                process.env.ANTHROPIC_API_KEY,
  MB_URL:                process.env.METABASE_URL,
  MB_KEY:                process.env.METABASE_API_KEY,
  MOENGAGE_APP_ID:       process.env.MOENGAGE_APP_ID       || '95PNUHBSYSLLJZ22PEOFMKF2',
  MOENGAGE_API_KEY:      process.env.MOENGAGE_API_KEY      || '3XMHJ83D2X4V',
  MOENGAGE_DATA_API_KEY: process.env.MOENGAGE_DATA_API_KEY || 'Mj5JSGKcwYum9NKAGmGHJG_E',
  MOENGAGE_API_URL:      process.env.MOENGAGE_API_URL      || 'https://api-01.moengage.com',
  MOENGAGE_PUSH_URL:     process.env.MOENGAGE_PUSH_URL,
  PG_HOST:               process.env.PG_HOST,
  PG_PORT:               process.env.PG_PORT,
  PG_USER:               process.env.PG_USER,
  PG_PASSWORD:           process.env.PG_PASSWORD,
  PG_DATABASE:           process.env.PG_DATABASE,
  RETELL_API_KEY:        process.env.RETELL_API_KEY,
  RETELL_AGENT_ID:       process.env.RETELL_AGENT_ID,
  MIXPANEL_SECRET:       process.env.MIXPANEL_API_SECRET,
  MIXPANEL_TOKEN:        process.env.MIXPANEL_TOKEN,
  MIXPANEL_PROJECT_ID:   process.env.MIXPANEL_PROJECT_ID,
  AWS_ACCESS_KEY_ID:     process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  S3_BUCKET:             process.env.S3_BUCKET,
  AWS_REGION:            process.env.AWS_REGION,
  GEMINI_API_KEY:        process.env.GEMINI_API_KEY,
  ENABLE_GEMINI:         process.env.ENABLE_GEMINI !== 'false',
  OPENROUTER_KEY:        process.env.OPENROUTER_KEY,
};

const REFRESH_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const RISK_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Drift governance: alert only when AUC drops >5% for 2+ consecutive runs
const DRIFT_CFG = {
  baselineAuc:       parseFloat(process.env.DRIFT_BASELINE_AUC || '0.90'),
  dropThresholdPct:  parseFloat(process.env.DRIFT_DROP_PCT || '5'),
  consecutiveRuns:   parseInt(process.env.DRIFT_CONSECUTIVE_RUNS || '2'),
  featureZThreshold: parseFloat(process.env.DRIFT_Z_THRESHOLD || '2.0'),
};

// Revenue simulation constants
const MARGIN_PER_TXN = 8.50;
const LTV_MULTIPLIER = 2.3;

// API response pagination defaults
const DEFAULT_LIMITS = { at_risk: 80, churned_sample: 40, healthy_sample: 40, early_warnings: 200, users: 200, intervention_log: 100, campaign_history: 50 };

// Revenue simulator fallbacks (used when playbook not found in DOMAIN.INTERVENTIONS)
const SIMULATOR_DEFAULTS = { lift_rate: 0.10, cost_per_user: 1.00 };

// Cohort thresholds for the price_sensitive segment
const PRICE_SENSITIVE_RANGE = { min: 0.3, max: 0.7 };

const MIXPANEL_FUNNELS = {
  onboarding: { id: 87507718, name: 'Onboarding Funnel' },
  activation: { id: 85141774, name: 'Onboarding + Activation' },
  uae_onboarding: { id: 86423593, name: 'UAE Onboarding' },
  uk_onboarding: { id: 86423594, name: 'UK Onboarding' },
  us_onboarding: { id: 86423597, name: 'US Onboarding' },
};

// Reason → intervention type mapping (channel/cost/lift derived from DOMAIN.INTERVENTIONS)
const INTERVENTION_MESSAGES = {
  support_callback: 'Schedule priority support callback to resolve transaction failures',
  speed_guarantee:  'Offer guaranteed fast-track delivery on next 3 transfers',
  loyalty_discount: 'Exclusive loyalty pricing: reduced fees for next 5 transfers',
  priority_queue:   'Priority queue access — skip the line on stuck transfers',
  re_engagement:    'Personalized re-engagement with recent corridor rate improvements',
};

function buildIntervention(type, messageOverride) {
  const base = DOMAIN.INTERVENTIONS[type] || DOMAIN.INTERVENTIONS.re_engagement;
  return { type, ...base, message: messageOverride || INTERVENTION_MESSAGES[type] };
}

const INTERVENTION_MAP = {
  failure_rate:        buildIntervention('support_callback'),
  high_failure_rate:   buildIntervention('support_callback'),
  api_errors:          buildIntervention('support_callback', 'Proactive tech support outreach for recurring errors'),
  slow_delivery:       buildIntervention('speed_guarantee'),
  delivery_speed:      buildIntervention('speed_guarantee'),
  pricing:             buildIntervention('loyalty_discount'),
  pricing_sensitivity: buildIntervention('loyalty_discount'),
  stuck_rate:          buildIntervention('priority_queue'),
  stuck_transaction:   buildIntervention('priority_queue'),
  inactivity:          buildIntervention('re_engagement'),
  low_engagement:      buildIntervention('re_engagement'),
};

function getIntervention(user) {
  if (!user.reasons || !user.reasons.length) return INTERVENTION_MAP.inactivity;
  const primaryReason = user.reasons[0].code || '';
  for (const [key, intervention] of Object.entries(INTERVENTION_MAP)) {
    if (primaryReason.toLowerCase().includes(key)) return intervention;
  }
  return INTERVENTION_MAP.inactivity;
}

module.exports = {
  CFG,
  DOMAIN,
  REFRESH_INTERVAL,
  RISK_CACHE_TTL,
  DRIFT_CFG,
  MARGIN_PER_TXN,
  LTV_MULTIPLIER,
  DEFAULT_LIMITS,
  SIMULATOR_DEFAULTS,
  PRICE_SENSITIVE_RANGE,
  MIXPANEL_FUNNELS,
  INTERVENTION_MAP,
  getIntervention,
};
