require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { QUERIES } = require('./queries');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, maxAge: 0 }));
app.use(function(req, res, next) { res.set('Cache-Control', 'no-store'); next(); });

// ── Configuration ──────────────────────────────────────────────────────────────
const CFG = {
  AI_KEY:                process.env.ANTHROPIC_API_KEY,
  MB_URL:                process.env.METABASE_URL,
  MB_KEY:                process.env.METABASE_API_KEY,
  MOENGAGE_APP_ID:       process.env.MOENGAGE_APP_ID,
  MOENGAGE_API_KEY:      process.env.MOENGAGE_API_KEY,
  MOENGAGE_DATA_API_KEY: process.env.MOENGAGE_DATA_API_KEY,
  MOENGAGE_API_URL:      process.env.MOENGAGE_API_URL,
  RETELL_API_KEY:        process.env.RETELL_API_KEY,
  RETELL_AGENT_ID:       process.env.RETELL_AGENT_ID,
  MIXPANEL_SECRET:       process.env.MIXPANEL_API_SECRET,
  MIXPANEL_TOKEN:        process.env.MIXPANEL_TOKEN,
  MIXPANEL_PROJECT_ID:   process.env.MIXPANEL_PROJECT_ID,
  AWS_ACCESS_KEY_ID:     process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  S3_BUCKET:             process.env.S3_BUCKET,
  AWS_REGION:            process.env.AWS_REGION,
};

const REFRESH_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

// ── Redshift Direct Connection ────────────────────────────────────────────────
const redshiftPool = new Pool({
  host: process.env.REDSHIFT_HOST,
  port: parseInt(process.env.REDSHIFT_PORT || '5439'),
  user: process.env.REDSHIFT_USER,
  password: process.env.REDSHIFT_PASSWORD,
  database: process.env.REDSHIFT_DB || 'dev',
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000,
});

// ── Load Dashboard Data ────────────────────────────────────────────────────────
let data = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'churn_dashboard_data.json'), 'utf8')
);

// ── Load Real Transaction Data (if available) ─────────────────────────────────
const realTxnPath = path.join(__dirname, 'data', 'real_transactions.json');
let realData = null;
if (fs.existsSync(realTxnPath)) {
  realData = JSON.parse(fs.readFileSync(realTxnPath, 'utf8'));
  // Merge real data into dashboard data — real data takes priority
  data.summary = realData.summary;
  data.churn_overview = realData.churn_overview;
  data.corridor_analysis = realData.corridor_analysis;
  data.interventions = realData.interventions;
  data.backtest = realData.backtest;
  data.reason_frequency = realData.reason_frequency;
  data.transaction_status = realData.transaction_status;
  data.model = { ...data.model, real_data: true, real_users: realData.summary.total_users, real_txns: realData.summary.total_txns };
  // Replace user samples and cohorts with real data
  data.at_risk_users = realData.at_risk_users;
  data.churned_sample = realData.churned_sample;
  data.healthy_sample = realData.healthy_sample;
  if (realData.cohorts) data.cohorts = realData.cohorts;
  console.log(`[Real Data] Loaded ${realData.summary.total_users.toLocaleString()} users from ${realData.summary.total_txns.toLocaleString()} transactions`);
}

// Build user index from all user arrays
let userIndex = {};
function rebuildUserIndex() {
  userIndex = {};
  [
    ...(data.at_risk_users  || []),
    ...(data.churned_sample || []),
    ...(data.healthy_sample || []),
  ].forEach(u => {
    if (!userIndex[u.user_id]) userIndex[u.user_id] = u;
  });
}
rebuildUserIndex();

console.log(`Loaded ${Object.keys(userIndex).length} users | Model: ${data.model?.type || 'rules'}`);

// ── Live Data Cache (from Metabase) ────────────────────────────────────────────
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

// ── Mixpanel Live Data Cache ──────────────────────────────────────────────────
const mixpanelData = {
  funnels: {},           // funnel_id -> { name, steps: [{goal, count, pct}] }
  engage_stats: null,    // { total, kyc, push, referred, countries }
  event_counts: null,    // { date, events: {event_name: count} }
  last_refresh: null,
};

// Key funnels to pull (curated from 1,212 available)
const MIXPANEL_FUNNELS = {
  onboarding: { id: 87507718, name: 'Onboarding Funnel' },
  activation: { id: 85141774, name: 'Onboarding + Activation' },
  uae_onboarding: { id: 86423593, name: 'UAE Onboarding' },
  uk_onboarding: { id: 86423594, name: 'UK Onboarding' },
  us_onboarding: { id: 86423597, name: 'US Onboarding' },
};

// ── Sentiment Cache (per-user, AI-analyzed) ──────────────────────────────────
const sentimentCache = {};

// ── S3 Client (Campaign Audit Trail) ─────────────────────────────────────────
const s3 = CFG.AWS_ACCESS_KEY_ID && CFG.S3_BUCKET
  ? new S3Client({
      region: CFG.AWS_REGION,
      credentials: { accessKeyId: CFG.AWS_ACCESS_KEY_ID, secretAccessKey: CFG.AWS_SECRET_ACCESS_KEY },
    })
  : null;

async function writeToS3(key, data) {
  if (!s3) {
    console.log(`[S3] Not configured — would write ${key}`);
    return { mock: true, key };
  }
  try {
    await s3.send(new PutObjectCommand({
      Bucket: CFG.S3_BUCKET,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    }));
    console.log(`[S3] Wrote ${key}`);
    return { success: true, key, bucket: CFG.S3_BUCKET };
  } catch (e) {
    console.error(`[S3] Write failed for ${key}:`, e.message);
    return { success: false, key, error: e.message };
  }
}

// ── Campaign Audit Log (in-memory + S3) ──────────────────────────────────────
const campaignLog = [];

// ── LLM Risk Analysis Cache (5-min TTL) ─────────────────────────────────────
const riskAnalysisCache = {};
const RISK_CACHE_TTL = 5 * 60 * 1000;

// ── Load Real Decagon Conversations ───────────────────────────────────────────
const decagonData = {};
try {
  const csvPath = path.join(__dirname, 'data', 'decagon_conversations.csv');
  if (fs.existsSync(csvPath)) {
    const csvText = fs.readFileSync(csvPath, 'utf8');
    // Simple CSV parser (handles quoted fields with commas/newlines)
    function parseCSV(text) {
      const rows = []; let row = []; let field = ''; let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
          if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
          else if (ch === '"') { inQuotes = false; }
          else { field += ch; }
        } else {
          if (ch === '"') { inQuotes = true; }
          else if (ch === ',') { row.push(field); field = ''; }
          else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
            row.push(field); field = '';
            if (row.length > 1) rows.push(row);
            row = [];
            if (ch === '\r') i++;
          } else { field += ch; }
        }
      }
      if (field || row.length) { row.push(field); rows.push(row); }
      return rows;
    }

    const parsed = parseCSV(csvText);
    const headers = parsed[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h.trim()] = i; });

    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      const userId = (r[colIdx['user_id']] || '').trim();
      if (!userId) continue;

      const conv = {
        conversation_id: r[colIdx['conversation_id']] || '',
        user_id: userId,
        destination: r[colIdx['destination']] || '',
        created_at: r[colIdx['created_at']] || '',
        summary: (r[colIdx['summary']] || '').trim(),
        resolution: (r[colIdx['resolution']] || '').trim(),
        flow_type: r[colIdx['flow_type']] || '',
        csat_rating: r[colIdx['csat_rating']] || '',
        meta_country: r[colIdx['meta_country']] || '',
        meta_order_id: r[colIdx['meta_order_id']] || '',
        meta_first_name: r[colIdx['meta_first_name']] || '',
        meta_last_name: r[colIdx['meta_last_name']] || '',
      };

      // Extract user messages from messages JSON
      const msgsRaw = r[colIdx['messages']] || '';
      try {
        const msgs = JSON.parse(msgsRaw);
        conv.user_messages = msgs
          .filter(m => m.role === 'USER' && m.text && !m.text.startsWith('Uploaded file'))
          .map(m => m.text)
          .slice(0, 10);
        conv.ai_messages = msgs
          .filter(m => m.role === 'AI' && m.text)
          .map(m => m.text)
          .slice(0, 5);
        conv.message_count = msgs.length;
      } catch (e) {
        conv.user_messages = [];
        conv.ai_messages = [];
        conv.message_count = 0;
      }

      // Build a conversation summary from user messages if no summary exists
      if (!conv.summary && conv.user_messages.length) {
        conv.summary = 'User wrote: ' + conv.user_messages.slice(0, 3).join(' | ');
      }

      if (!decagonData[userId]) decagonData[userId] = [];
      decagonData[userId].push(conv);
    }

    // Sort each user's conversations by date (newest first)
    for (const uid of Object.keys(decagonData)) {
      decagonData[uid].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }

    console.log(`Loaded ${Object.keys(decagonData).length} users from Decagon CSV (${parsed.length - 1} conversations)`);
  }
} catch (e) {
  console.log(`Decagon CSV load skipped: ${e.message}`);
}

// ── Intervention Assignment Logic ──────────────────────────────────────────────
const INTERVENTION_MAP = {
  failure_rate:        { type: 'support_callback',  channel: 'Phone + SMS',       cost: 3.50, lift: '18-22%', message: 'Schedule priority support callback to resolve transaction failures' },
  high_failure_rate:   { type: 'support_callback',  channel: 'Phone + SMS',       cost: 3.50, lift: '18-22%', message: 'Schedule priority support callback to resolve transaction failures' },
  api_errors:          { type: 'support_callback',  channel: 'Phone + SMS',       cost: 3.50, lift: '18-22%', message: 'Proactive tech support outreach for recurring errors' },
  slow_delivery:       { type: 'speed_guarantee',   channel: 'WhatsApp + Email',  cost: 1.20, lift: '12-16%', message: 'Offer guaranteed fast-track delivery on next 3 transfers' },
  delivery_speed:      { type: 'speed_guarantee',   channel: 'WhatsApp + Email',  cost: 1.20, lift: '12-16%', message: 'Offer guaranteed fast-track delivery on next 3 transfers' },
  pricing:             { type: 'loyalty_discount',   channel: 'Email + In-app',    cost: 2.00, lift: '14-18%', message: 'Exclusive loyalty pricing: reduced fees for next 5 transfers' },
  pricing_sensitivity: { type: 'loyalty_discount',   channel: 'Email + In-app',    cost: 2.00, lift: '14-18%', message: 'Exclusive loyalty pricing: reduced fees for next 5 transfers' },
  stuck_rate:          { type: 'priority_queue',     channel: 'SMS + In-app',      cost: 0.50, lift: '10-14%', message: 'Priority queue access — skip the line on stuck transfers' },
  stuck_transaction:   { type: 'priority_queue',     channel: 'SMS + In-app',      cost: 0.50, lift: '10-14%', message: 'Priority queue access — skip the line on stuck transfers' },
  inactivity:          { type: 're_engagement',      channel: 'Email + Push',      cost: 0.15, lift: '6-9%',   message: 'Personalized re-engagement with recent corridor rate improvements' },
  low_engagement:      { type: 're_engagement',      channel: 'Email + Push',      cost: 0.15, lift: '6-9%',   message: 'Personalized re-engagement with recent corridor rate improvements' },
};

function getIntervention(user) {
  if (!user.reasons || !user.reasons.length) return INTERVENTION_MAP.inactivity;
  const primaryReason = user.reasons[0].code || '';
  for (const [key, intervention] of Object.entries(INTERVENTION_MAP)) {
    if (primaryReason.toLowerCase().includes(key)) return intervention;
  }
  return INTERVENTION_MAP.inactivity;
}

// ═══════════════════════════════════════════════════════════════════════════════
// METABASE AUTO-REFRESH ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

async function runRedshiftQuery(queryKey) {
  const query = QUERIES[queryKey];
  if (!query) throw new Error(`Unknown query: ${queryKey}`);

  const client = await redshiftPool.connect();
  try {
    const result = await client.query(query.sql);
    const columns = result.fields.map(f => f.name);
    const rows = result.rows;
    return { columns, rows, row_count: rows.length };
  } finally {
    client.release();
  }
}

async function refreshAllData() {
  const ts = new Date().toISOString();
  console.log(`[${ts}] Starting data refresh from Redshift...`);

  // Run queries sequentially to avoid overwhelming Redshift cluster
  const allQueries = [
    'monthly_trends', 'corridor_health', 'partner_performance',
    'new_user_cohorts', 'prediction_validation',
    'early_warnings', 'decagon_conversations', 'delivery',
  ];

  for (const key of allQueries) {
    try {
      const start = Date.now();
      const result = await runRedshiftQuery(key);
      liveData[key] = result;
      liveData.refresh_status[key] = { status: 'ok', rows: result.row_count, at: ts };
      console.log(`  ✓ ${key}: ${result.row_count} rows (${Math.round((Date.now()-start)/1000)}s)`);
    } catch (e) {
      const isSkip = key === 'prediction_validation' || key === 'pricing';
      liveData.refresh_status[key] = { status: isSkip ? 'skipped' : 'error', error: e.message, at: ts };
      console.log(`  ${isSkip ? '~' : '✗'} ${key}: ${e.message.slice(0, 80)}`);
    }
  }

  liveData.last_refresh = ts;
  console.log(`[${new Date().toISOString()}] Refresh complete`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIXPANEL DATA REFRESH
// ═══════════════════════════════════════════════════════════════════════════════

function mixpanelAuth() {
  return `Basic ${Buffer.from(`${CFG.MIXPANEL_SECRET}:`).toString('base64')}`;
}

async function fetchMixpanelFunnel(funnelId, fromDate, toDate) {
  const params = new URLSearchParams({ funnel_id: funnelId, from_date: fromDate, to_date: toDate, unit: 'month' });
  const resp = await fetch(`https://mixpanel.com/api/2.0/funnels?${params}`, {
    headers: { 'Authorization': mixpanelAuth() },
  });
  if (!resp.ok) throw new Error(`Mixpanel ${resp.status}`);
  return resp.json();
}

async function fetchMixpanelEngageStats() {
  // Pull 1000-user sample to compute aggregate stats
  const resp = await fetch(`https://mixpanel.com/api/2.0/engage?page_size=1000`, {
    headers: { 'Authorization': mixpanelAuth() },
  });
  if (!resp.ok) throw new Error(`Mixpanel Engage ${resp.status}`);
  const data = await resp.json();

  const total = data.total || 0;
  const results = data.results || [];
  const stats = { total, sample_size: results.length, kyc: {}, push: { enabled: 0, disabled: 0 }, referred: { yes: 0, no: 0 }, countries: {} };

  for (const r of results) {
    const p = r.$properties || {};
    const kyc = (p.user_kyc_status || '').toUpperCase() || 'UNKNOWN';
    stats.kyc[kyc] = (stats.kyc[kyc] || 0) + 1;
    stats.push[p.push_notification ? 'enabled' : 'disabled']++;
    stats.referred[p.is_referred ? 'yes' : 'no']++;
    const cc = p.$country_code || 'OTHER';
    stats.countries[cc] = (stats.countries[cc] || 0) + 1;
  }

  return stats;
}

async function refreshMixpanelData() {
  if (!CFG.MIXPANEL_SECRET) {
    console.log('[Mixpanel] Not configured — skipping');
    return;
  }

  const ts = new Date().toISOString();
  console.log(`[${ts}] Starting Mixpanel data refresh...`);

  const now = new Date();
  const fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const toDate = now.toISOString().split('T')[0];

  // Pull all funnels in parallel
  const funnelKeys = Object.keys(MIXPANEL_FUNNELS);
  await Promise.all(funnelKeys.map(async (key) => {
    const f = MIXPANEL_FUNNELS[key];
    try {
      const result = await fetchMixpanelFunnel(f.id, fromDate, toDate);
      const dates = result.data || {};
      // Get the most recent date's steps
      const latestDate = Object.keys(dates).sort().pop();
      const steps = latestDate ? (dates[latestDate].steps || []) : [];
      const formatted = steps.map((s, i) => ({
        step: i + 1,
        goal: s.goal || s.event,
        count: s.count,
        overall_pct: Math.round((s.overall_conv_ratio || 0) * 1000) / 10,
        step_pct: Math.round((s.step_conv_ratio || 0) * 1000) / 10,
      }));
      mixpanelData.funnels[key] = { name: f.name, funnel_id: f.id, date: latestDate, steps: formatted };
      console.log(`  ✓ funnel:${key}: ${formatted.length} steps (${formatted[0]?.count || 0} entered)`);
    } catch (e) {
      console.log(`  ✗ funnel:${key}: ${e.message.slice(0, 80)}`);
    }
  }));

  // Pull engage stats
  try {
    mixpanelData.engage_stats = await fetchMixpanelEngageStats();
    console.log(`  ✓ engage: ${mixpanelData.engage_stats.total.toLocaleString()} total profiles`);
  } catch (e) {
    console.log(`  ✗ engage: ${e.message.slice(0, 80)}`);
  }

  mixpanelData.last_refresh = ts;
  console.log(`[${ts}] Mixpanel refresh complete`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE DATA ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/data', (req, res) => {
  const limited = Object.assign({}, data);
  limited.at_risk_users  = (data.at_risk_users  || []).slice(0, 80);
  limited.churned_sample = (data.churned_sample || []).slice(0, 40);
  limited.healthy_sample = (data.healthy_sample || []).slice(0, 40);

  // Merge live Redshift data into response (check individual sources, don't wait for full refresh)
  {
    // Override corridor_analysis with real data
    if (liveData.corridor_health?.rows?.length) {
      const ca = {};
      let totalUsers = 0, totalActive = 0;
      liveData.corridor_health.rows.forEach(r => {
        const tu = Number(r.total_users) || 0;
        const a30 = Number(r.active_30d) || 0;
        ca[r.corridor] = {
          total: tu,
          active_30d: a30,
          inactive_30_60d: Number(r.inactive_30_60d) || 0,
          volume_30d: Number(r.volume_30d) || 0,
          volume_30_60d: Number(r.volume_30_60d) || 0,
          success_rate: Number(r.success_rate_30d) || 0,
          avg_delivery_min: Number(r.avg_delivery_min_30d) || 0,
          stuck_rate: Number(r.stuck_rate_pct) || 0,
          churn_rate: a30 && tu ? Math.round((1 - a30 / tu) * 10000) / 10000 : 0,
        };
        totalUsers += tu;
        totalActive += a30;
      });
      limited.corridor_analysis = ca;
      limited.summary = Object.assign({}, limited.summary, {
        total_users: totalUsers,
        active_30d: totalActive,
        data_source: 'redshift_live',
      });
    }

    // Override at_risk_users with early warning data
    if (liveData.early_warnings?.rows?.length) {
      limited.at_risk_users = liveData.early_warnings.rows.slice(0, 200).map(r => ({
        user_id: r.user_id,
        corridor: r.corridor === 'UAE' ? 'UAE → India' : r.corridor === 'UK' ? 'UK → India' : r.corridor === 'US' ? 'US → India' : 'Other',
        currency: r.currency_from,
        tenure_days: r.tenure_days,
        total_txns: r.total_txns,
        completed_txns: r.completed || 0,
        failed_txns: r.failed || 0,
        total_volume: r.total_volume,
        days_since_last: r.days_since_last,
        fail_rate: r.total_txns > 0 ? Math.round((r.failed || 0) / r.total_txns * 10000) / 10000 : 0,
        risk_signals: r.total_risk_signals,
        signal_frequency_drop: r.signal_frequency_drop,
        signal_volume_drop: r.signal_volume_drop,
        signal_high_failures: r.signal_high_failures,
        signal_going_inactive: r.signal_going_inactive,
        signal_slow_delivery: r.signal_slow_delivery,
        signal_stuck_now: r.signal_stuck_now,
        ml_score: Math.min(0.5 + r.total_risk_signals * 0.1, 0.99),
        risk_tier: r.total_risk_signals >= 4 ? 'CRITICAL' : r.total_risk_signals >= 3 ? 'HIGH' : r.total_risk_signals >= 2 ? 'MEDIUM' : 'LOW',
        primary_reason: r.signal_high_failures ? 'failure_rate' : r.signal_slow_delivery ? 'slow_delivery' : r.signal_stuck_now ? 'stuck_transfer' : r.signal_frequency_drop ? 'frequency_decline' : r.signal_volume_drop ? 'volume_decline' : 'inactivity',
        source: 'redshift_live',
      }));
    }

    // Add monthly trends
    if (liveData.monthly_trends?.rows?.length) {
      limited.monthly_trends = liveData.monthly_trends.rows;
    }

    // Add partner performance
    if (liveData.partner_performance?.rows?.length) {
      limited.partner_performance = liveData.partner_performance.rows;
    }
  }

  // Include Mixpanel data
  if (mixpanelData.last_refresh) {
    limited.mixpanel = {
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
    };
  } else {
    // Always include daily_snapshot even before Mixpanel refresh
    limited.mixpanel = {
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
    };
  }

  // Include live data status
  const hasAnyLive = !!(liveData.corridor_health || liveData.early_warnings || liveData.monthly_trends);
  limited.live_data = {
    available: hasAnyLive || !!liveData.last_refresh,
    last_refresh: liveData.last_refresh,
    sources: liveData.refresh_status,
    mixpanel: !!mixpanelData.last_refresh,
  };
  res.json(limited);
});

app.get('/api/users', (req, res) => {
  let users = Object.values(userIndex);
  const { tier, corridor, search, sort, limit } = req.query;

  if (tier && tier !== 'ALL')         users = users.filter(u => u.risk_tier === tier);
  if (corridor && corridor !== 'ALL') users = users.filter(u => u.corridor === corridor);
  if (search)                         users = users.filter(u => u.user_id.includes(search));

  if (sort === 'volume')      users.sort((a, b) => b.total_volume - a.total_volume);
  else if (sort === 'days')   users.sort((a, b) => b.days_since_last - a.days_since_last);
  else                        users.sort((a, b) => b.risk_score - a.risk_score);

  res.json(users.slice(0, parseInt(limit) || 200));
});

app.get('/api/users/:id', (req, res) => {
  const user = userIndex[req.params.id];
  if (user) res.json(user);
  else res.status(404).json({ error: 'User not found' });
});

app.get('/api/model', (req, res) => {
  res.json(data.model || {});
});

app.get('/api/impact', (req, res) => {
  const churned = data.churned_sample || [];
  const totalChurned = data.backtest.total_churned;
  const sumVolume = churned.reduce((s, u) => s + u.total_volume, 0);
  const avgVolume = sumVolume / Math.max(churned.length, 1) / 6;
  const avgAnnualRevenue = avgVolume * 12 * 0.02;
  const interventionCost = Object.values(data.interventions).reduce((s, v) => s + v.cost, 0);

  res.json({
    total_churned: totalChurned,
    avg_annual_revenue_per_user: Math.round(avgAnnualRevenue),
    scenarios: [
      { label: 'Conservative (5%)',  saved: Math.round(totalChurned * 0.05), revenue: Math.round(totalChurned * 0.05 * avgAnnualRevenue) },
      { label: 'Moderate (10%)',     saved: Math.round(totalChurned * 0.10), revenue: Math.round(totalChurned * 0.10 * avgAnnualRevenue) },
      { label: 'Optimistic (20%)',   saved: Math.round(totalChurned * 0.20), revenue: Math.round(totalChurned * 0.20 * avgAnnualRevenue) },
    ],
    intervention_cost: Math.round(interventionCost),
    roi_multiple: Math.round(totalChurned * 0.1 * avgAnnualRevenue / Math.max(interventionCost, 1)),
  });
});

app.get('/api/cohorts/dropout', (req, res) => {
  res.json({
    funnel: [
      { step: 'App Install',       users: 120000, drop: 0 },
      { step: 'Signup',            users: 89000,  drop: 31000 },
      { step: 'KYC Start',         users: 72000,  drop: 17000 },
      { step: 'KYC Upload',        users: 61000,  drop: 11000 },
      { step: 'KYC Verified',      users: 55000,  drop: 6000 },
      { step: '1st Transfer Init', users: 48000,  drop: 7000 },
      { step: '1st Transfer Done', users: 42000,  drop: 6000 },
      { step: '2nd Transfer',      users: 31000,  drop: 11000 },
      { step: 'Regular (5+)',      users: 22000,  drop: 9000 },
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE DATA ENDPOINTS (Metabase-powered)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/early-warnings — Real-time churn risk signals
app.get('/api/early-warnings', async (req, res) => {
  if (liveData.early_warnings) {
    return res.json({ source: 'cache', ...liveData.early_warnings });
  }
  // Try live query
  if (redshiftPool) {
    try {
      const result = await runRedshiftQuery('early_warnings');
      liveData.early_warnings = result;
      return res.json({ source: 'live', ...result });
    } catch (e) {
      return res.json({ source: 'error', error: e.message, rows: [], row_count: 0 });
    }
  }
  res.json({ source: 'unavailable', message: 'Connect Metabase for live early warnings', rows: [], row_count: 0 });
});

// GET /api/corridor-health — Real-time corridor performance
app.get('/api/corridor-health', async (req, res) => {
  if (liveData.corridor_health) {
    return res.json({ source: 'cache', ...liveData.corridor_health });
  }
  if (redshiftPool) {
    try {
      const result = await runRedshiftQuery('corridor_health');
      liveData.corridor_health = result;
      return res.json({ source: 'live', ...result });
    } catch (e) {
      return res.json({ source: 'error', error: e.message, rows: [], row_count: 0 });
    }
  }
  // Fallback to static data
  res.json({
    source: 'static',
    rows: Object.entries(data.corridor_analysis).map(([name, info]) => ({
      corridor: name,
      total_users: info.total,
      active_30d: info.active,
      churn_rate: info.churn_rate,
    })),
  });
});

// GET /api/monthly-trends — 12-month rolling trends
app.get('/api/monthly-trends', async (req, res) => {
  if (liveData.monthly_trends) {
    return res.json({ source: 'cache', ...liveData.monthly_trends });
  }
  if (redshiftPool) {
    try {
      const result = await runRedshiftQuery('monthly_trends');
      liveData.monthly_trends = result;
      return res.json({ source: 'live', ...result });
    } catch (e) {
      return res.json({ source: 'error', error: e.message, rows: [], row_count: 0 });
    }
  }
  res.json({ source: 'static', rows: data.monthly_trends || [], row_count: (data.monthly_trends || []).length });
});

// GET /api/partner-performance — Fulfillment partner stats
app.get('/api/partner-performance', async (req, res) => {
  if (liveData.partner_performance) {
    return res.json({ source: 'cache', ...liveData.partner_performance });
  }
  if (redshiftPool) {
    try {
      const result = await runRedshiftQuery('partner_performance');
      liveData.partner_performance = result;
      return res.json({ source: 'live', ...result });
    } catch (e) {
      return res.json({ source: 'error', error: e.message, rows: [], row_count: 0 });
    }
  }
  res.json({ source: 'unavailable', message: 'Connect Metabase for partner data', rows: [], row_count: 0 });
});

// GET /api/cohorts/new-users — New user cohort tracking
app.get('/api/cohorts/new-users', async (req, res) => {
  if (liveData.new_user_cohorts) {
    return res.json({ source: 'cache', ...liveData.new_user_cohorts });
  }
  if (redshiftPool) {
    try {
      const result = await runRedshiftQuery('new_user_cohorts');
      liveData.new_user_cohorts = result;
      return res.json({ source: 'live', ...result });
    } catch (e) {
      return res.json({ source: 'error', error: e.message, rows: [], row_count: 0 });
    }
  }
  res.json({ source: 'unavailable', message: 'Connect Metabase for cohort data', rows: [], row_count: 0 });
});

// GET /api/prediction-validation — Self-learning feedback
app.get('/api/prediction-validation', async (req, res) => {
  if (liveData.prediction_validation) {
    return res.json({ source: 'cache', ...liveData.prediction_validation });
  }
  if (redshiftPool) {
    try {
      const result = await runRedshiftQuery('prediction_validation');
      liveData.prediction_validation = result;
      return res.json({ source: 'live', ...result });
    } catch (e) {
      return res.json({ source: 'unavailable', message: 'Predictions table not yet created', rows: [], row_count: 0 });
    }
  }
  res.json({ source: 'unavailable', rows: [], row_count: 0 });
});

// POST /api/refresh — Manual data refresh
app.post('/api/refresh', async (req, res) => {
  try {
    await refreshAllData();
    res.json({
      status: 'refreshed',
      timestamp: liveData.last_refresh,
      sources: liveData.refresh_status,
    });
  } catch (e) {
    res.status(500).json({ error: 'Refresh failed', detail: e.message });
  }
});

// GET /api/refresh-status — Check refresh state
app.get('/api/refresh-status', (req, res) => {
  res.json({
    last_refresh: liveData.last_refresh,
    next_refresh: liveData.last_refresh
      ? new Date(new Date(liveData.last_refresh).getTime() + REFRESH_INTERVAL).toISOString()
      : null,
    sources: liveData.refresh_status,
    redshift_connected: !!redshiftPool,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COHORT ANALYSIS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/cohorts', (req, res) => {
  res.json(data.cohorts || []);
});

app.get('/api/cohorts/:key', (req, res) => {
  const cohort = (data.cohorts || []).find(c => c.key === req.params.key);
  if (!cohort) return res.status(404).json({ error: 'Cohort not found' });
  res.json(cohort);
});

app.get('/api/cohorts/:key/playbook', (req, res) => {
  const cohort = (data.cohorts || []).find(c => c.key === req.params.key);
  if (!cohort) return res.status(404).json({ error: 'Cohort not found' });
  res.json({
    cohort: cohort.label,
    description: cohort.description,
    count: cohort.count,
    churn_rate: cohort.churn_rate,
    retention_strategy: cohort.retention_strategy,
    sample_users: cohort.sample_users,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTIVE IMPACT, SHAP, EXPERIMENTS, MODEL HEALTH, DATA HEALTH, COMPLIANCE
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// USER DOSSIER & SCORING
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/users/:id/dossier', async (req, res) => {
  const user = userIndex[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const intervention = user.intervention || getIntervention(user);
  const timeline = (data.user_timelines || {})[req.params.id] || null;
  const shapUser = (data.shap_data?.user_shap || []).find(s => s.user_id === req.params.id);
  const cohort = (data.cohorts || []).find(c =>
    (c.sample_users || []).some(u => u.user_id === req.params.id)
  );

  // Build nudge sequence
  const nudge_sequence = [
    { day: 0, action: `Send ${intervention.channel.split('+')[0].trim().toLowerCase()}`, channel: intervention.channel.split('+')[0].trim(), message: intervention.message },
    { day: 3, action: 'Follow-up if no response', channel: 'Email', message: `Reminder: ${intervention.message}` },
    { day: 7, action: 'Escalate channel', channel: 'WhatsApp', message: 'We noticed you haven\'t completed a transfer recently. Can we help?' },
  ];
  if (user.risk_tier === 'CRITICAL') {
    nudge_sequence.push({ day: 10, action: 'AI phone call', channel: 'Phone', message: 'Priority retention call' });
  }

  // Get sentiment data
  let sentiment = null;
  try { sentiment = await analyzeSentiment(req.params.id); } catch (e) { /* skip */ }

  const dossier = {
    user_id: req.params.id,
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
    sentiment,
  };

  // If AI key available, generate AI-enhanced dossier summary
  if (CFG.AI_KEY) {
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
    } catch (e) { /* skip AI summary */ }
  }

  // Merge LLM risk analysis (from cache or run fresh)
  try {
    const riskAnalysis = await runRiskAnalysis(req.params.id);
    if (riskAnalysis) {
      const { _ts, ...clean } = riskAnalysis;
      dossier.llm_risk_signals = clean.risk_signals || null;
      dossier.llm_intervention_plan = clean.intervention_plan || null;
      dossier.llm_justification = clean.justification || null;
      dossier.llm_urgency = clean.urgency || null;
      dossier.llm_confidence = clean.confidence || null;
      dossier.llm_source = clean.source || null;
    }
  } catch (e) { /* skip LLM risk analysis */ }

  res.json(dossier);
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER SENTIMENT (Decagon Conversations)
// ═══════════════════════════════════════════════════════════════════════════════

function getDecagonConversations(userId) {
  // Try real Decagon CSV data first
  if (decagonData[userId]?.length) {
    return decagonData[userId];
  }
  // Try live Metabase data
  if (liveData.decagon_conversations?.rows?.length) {
    return liveData.decagon_conversations.rows.filter(r => r.user_id === userId);
  }
  // Fall back to demo data
  return (data.user_sentiment || {})[userId]?.conversations || [];
}

async function analyzeSentiment(userId) {
  // Check cache first
  if (sentimentCache[userId]) return sentimentCache[userId];

  const conversations = getDecagonConversations(userId);
  const user = userIndex[userId];

  // If we have pre-computed sentiment from demo data, use it
  if ((data.user_sentiment || {})[userId]) {
    sentimentCache[userId] = data.user_sentiment[userId];
    return sentimentCache[userId];
  }

  if (!conversations.length) {
    return { user_id: userId, has_conversations: false, sentiment: 'unknown', pain_points: [], summary: 'No support conversations found.' };
  }

  // Build conversation context for AI analysis
  const convContext = conversations.slice(0, 3).map((c, i) => {
    const summaryText = c.conversation_summary || c.summary || '';
    const userMsgs = c.user_messages ? c.user_messages.join(' | ') : '';
    const resText = c.resolution || '';
    const rating = c.csat_rating || c.rating || '';
    return `Conversation ${i + 1} (${c.created_at || c.date || 'recent'}, ${c.channel || c.flow_type || c.destination || 'unknown'}, order: ${c.meta_order_id || 'N/A'}):
Summary: ${summaryText || 'N/A'}
User messages: ${userMsgs || 'N/A'}
Resolution: ${resText || 'N/A'}
CSAT: ${rating || 'N/A'}`;
  }).join('\n\n');

  // Use Claude to analyze sentiment and extract pain points
  if (CFG.AI_KEY) {
    try {
      const prompt = `Analyze these customer support conversations for a cross-border remittance user. Extract:
1. Overall sentiment (positive/neutral/negative/frustrated)
2. Pain points (list each specific issue)
3. A 2-sentence summary of customer experience
4. Risk signal: does this suggest the user is likely to churn? (yes/maybe/no)
5. Urgency: how urgently should retention team act? (immediate/soon/monitor)

User context: ${user ? `${user.corridor} corridor, ${user.tenure_days}d tenure, ${user.total_txns} transactions, risk tier: ${user.risk_tier}` : 'unknown'}

Conversations:
${convContext}

Respond in JSON format: {"sentiment":"...","pain_points":["..."],"summary":"...","churn_signal":"...","urgency":"..."}`;

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.AI_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
      });
      const d = await resp.json();
      const text = d.content?.[0]?.text || '';

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let analysis = {};
      if (jsonMatch) {
        try { analysis = JSON.parse(jsonMatch[0]); } catch (e) { /* fallback below */ }
      }

      const result = {
        user_id: userId,
        has_conversations: true,
        conversation_count: conversations.length,
        last_interaction: conversations[0]?.created_at || conversations[0]?.date || null,
        last_channel: conversations[0]?.channel || conversations[0]?.flow_type || conversations[0]?.destination || null,
        last_rating: conversations[0]?.csat_rating || conversations[0]?.rating || null,
        sentiment: analysis.sentiment || 'unknown',
        pain_points: analysis.pain_points || [],
        summary: analysis.summary || text.slice(0, 300),
        churn_signal: analysis.churn_signal || 'unknown',
        urgency: analysis.urgency || 'monitor',
        conversations: conversations.slice(0, 3).map(c => ({
          date: c.created_at || c.date,
          channel: c.channel || c.flow_type || c.destination,
          status: c.resolution ? 'resolved' : (c.resolution_status || c.status || 'open'),
          summary: c.conversation_summary || c.summary || (c.user_messages ? c.user_messages.join(' | ') : ''),
          resolution: c.resolution || null,
          rating: c.csat_rating || c.rating || null,
          order_id: c.meta_order_id || null,
          user_messages: c.user_messages || [],
        })),
      };
      sentimentCache[userId] = result;
      return result;
    } catch (e) {
      console.error('Sentiment analysis error:', e.message);
    }
  }

  // Fallback: rule-based sentiment extraction
  const allText = conversations.map(c => {
    const parts = [c.conversation_summary || c.summary || '', c.resolution || ''];
    if (c.user_messages) parts.push(c.user_messages.join(' '));
    return parts.join(' ');
  }).join(' ').toLowerCase();
  const painKeywords = {
    'transaction failed': 'Transaction failures',
    'failed': 'Transaction failures',
    'stuck': 'Stuck transactions',
    'slow': 'Slow delivery',
    'delay': 'Delivery delays',
    'taking longer': 'Delivery delays',
    'not received': 'Money not received',
    'not credited': 'Not credited to beneficiary',
    'not been credited': 'Not credited to beneficiary',
    'pending': 'Pending transfer',
    'processing': 'Still processing',
    'still processing': 'Long processing time',
    'error': 'System errors',
    'fee': 'Fee concerns',
    'rate': 'Exchange rate issues',
    'expensive': 'Pricing concerns',
    'refund': 'Refund requests',
    'cancel': 'Cancellation requests',
    'kyc': 'KYC/verification issues',
    'verification': 'Verification difficulties',
    'phone number': 'Account issues',
    'cannot': 'Access issues',
    'can\'t': 'Access issues',
    'support': 'Support experience issues',
    'wait': 'Long wait times',
    'waiting': 'Long wait times',
    'frustrat': 'User frustration',
    'urgent': 'Urgency expressed',
    'not working': 'App functionality issues',
    'wrong': 'Incorrect transaction details',
    'lost': 'Lost funds concern',
    'where is my money': 'Money whereabouts unknown',
    'not gon': 'Money not received',
    'escalat': 'Issue escalated',
  };

  const painPoints = [];
  for (const [keyword, label] of Object.entries(painKeywords)) {
    if (allText.includes(keyword) && !painPoints.includes(label)) painPoints.push(label);
  }

  const negativeWords = ['frustrated', 'angry', 'upset', 'disappointed', 'terrible', 'worst', 'never', 'refund', 'cancel', 'lost', 'fail', 'error', 'stuck', 'broken', 'pending', 'delay', 'not received', 'not credited', 'taking longer', 'waiting', 'urgent', 'escalat', 'where is my money', 'not gon', 'why my money'];
  const negCount = negativeWords.filter(w => allText.includes(w)).length;
  const sentiment = negCount >= 4 ? 'frustrated' : negCount >= 2 ? 'negative' : negCount >= 1 ? 'concerned' : 'neutral';

  const result = {
    user_id: userId,
    has_conversations: true,
    conversation_count: conversations.length,
    last_interaction: conversations[0]?.created_at || conversations[0]?.date || null,
    sentiment,
    pain_points: painPoints.slice(0, 5),
    summary: `User had ${conversations.length} support interaction(s). ${painPoints.length ? 'Key concerns: ' + painPoints.slice(0, 3).join(', ') + '.' : 'No major pain points detected.'}`,
    churn_signal: negCount >= 2 ? 'yes' : negCount >= 1 ? 'maybe' : 'no',
    urgency: negCount >= 3 ? 'immediate' : negCount >= 1 ? 'soon' : 'monitor',
    conversations: conversations.slice(0, 3).map(c => ({
      date: c.created_at || c.date,
      channel: c.channel || c.flow_type || c.destination,
      status: c.resolution ? 'resolved' : (c.resolution_status || c.status || 'open'),
      summary: c.conversation_summary || c.summary || (c.user_messages ? c.user_messages.join(' | ') : ''),
      resolution: c.resolution || null,
      rating: c.csat_rating || c.rating || null,
      order_id: c.meta_order_id || null,
      user_messages: c.user_messages || [],
    })),
  };
  sentimentCache[userId] = result;
  return result;
}

app.get('/api/users/:id/sentiment', async (req, res) => {
  const userId = req.params.id;
  // Allow sentiment for both ML-scored users and Decagon-only users
  const hasDecagon = !!decagonData[userId];
  const hasModel = !!userIndex[userId];
  if (!hasDecagon && !hasModel) return res.status(404).json({ error: 'User not found' });

  try {
    const sentiment = await analyzeSentiment(userId);
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
      // Quick rule-based analysis for bulk view
      const convs = decagonData[userId];
      const allText = convs.map(c => {
        const parts = [c.summary || '', c.resolution || ''];
        if (c.user_messages) parts.push(c.user_messages.join(' '));
        return parts.join(' ');
      }).join(' ').toLowerCase();

      const negativeWords = ['pending', 'delay', 'slow', 'stuck', 'failed', 'not received', 'not credited', 'refund', 'cancel', 'frustrat', 'waiting', 'long time', 'where is my money', 'still processing', 'urgent'];
      const negCount = negativeWords.filter(w => allText.includes(w)).length;
      const sentiment = negCount >= 4 ? 'frustrated' : negCount >= 2 ? 'negative' : negCount >= 1 ? 'concerned' : 'neutral';

      const painKeywords = {
        'pending': 'Pending transfers', 'delay': 'Delivery delays', 'slow': 'Slow processing',
        'not received': 'Money not received', 'not credited': 'Not credited to beneficiary',
        'stuck': 'Stuck transactions', 'failed': 'Transaction failures', 'refund': 'Refund requests',
        'cancel': 'Cancellation requests', 'phone number': 'Account issues', 'kyc': 'KYC problems',
        'cannot': 'Access issues', 'error': 'System errors', 'waiting': 'Long wait times',
      };
      const painPoints = [];
      for (const [kw, label] of Object.entries(painKeywords)) {
        if (allText.includes(kw) && !painPoints.includes(label)) painPoints.push(label);
      }

      summary[userId] = {
        sentiment,
        pain_points_count: painPoints.length,
        churn_signal: negCount >= 3 ? 'yes' : negCount >= 1 ? 'maybe' : 'no',
        urgency: negCount >= 4 ? 'immediate' : negCount >= 2 ? 'soon' : 'monitor',
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

app.post('/api/score/user', (req, res) => {
  const { user_id } = req.body;
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

// Intervention outcome tracking (in-memory for demo)
const interventionLog = [];

app.post('/api/interventions/trigger', async (req, res) => {
  const { user_id, channel, campaign, playbook } = req.body;
  const user = userIndex[user_id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const entry = {
    id: `INT_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    user_id, channel: channel || 'push', campaign: campaign || 'manual',
    playbook: playbook || user.intervention?.type,
    risk_tier: user.risk_tier,
    churn_probability: user.churn_probability || user.risk_score,
    triggered_at: new Date().toISOString(),
    status: 'sent',
    outcome: null,
  };
  interventionLog.push(entry);

  // S3 audit trail
  const now = new Date();
  const dateKey = now.toISOString().split('T')[0];
  const campaignId = crypto.randomUUID();
  const intervention = user.intervention || getIntervention(user);
  const riskData = riskAnalysisCache[user_id] || null;
  const s3Record = {
    campaign_id: campaignId, triggered_at: now.toISOString(), triggered_by: 'dashboard',
    tier: user.risk_tier, channel_used: channel || 'push', llm_analysis_included: !!riskData,
    total_targeted: 1,
    users: [{
      user_id, corridor: user.corridor, risk_tier: user.risk_tier,
      churn_probability: user.churn_probability || user.risk_score,
      communication_type: (channel || 'push').toLowerCase(), tool_used: 'manual',
      sent_at: now.toISOString(), intervention_type: intervention.type,
      intervention_message: intervention.message,
      llm_risk_signals: riskData?.risk_signals || null, llm_justification: riskData?.justification || null,
      status: 'sent', moengage_response: null,
    }],
  };
  const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record);
  campaignLog.push({ ...s3Record, s3: s3Result });

  res.json({ ...entry, s3: s3Result });
});

app.post('/api/interventions/outcome', (req, res) => {
  const { intervention_id, outcome, notes } = req.body;
  const entry = interventionLog.find(e => e.id === intervention_id);
  if (!entry) return res.status(404).json({ error: 'Intervention not found' });
  entry.outcome = outcome; // 'retained', 'churned', 'no_response'
  entry.outcome_at = new Date().toISOString();
  entry.notes = notes;
  res.json(entry);
});

app.get('/api/interventions/log', (req, res) => {
  res.json(interventionLog.slice(-100));
});

// GET /api/campaigns/history — Recent campaign audit trail
app.get('/api/campaigns/history', (req, res) => {
  const recent = campaignLog.slice(-50).reverse().map(c => ({
    campaign_id: c.campaign_id,
    triggered_at: c.triggered_at,
    tier: c.tier,
    channel_used: c.channel_used,
    total_targeted: c.total_targeted,
    llm_analysis_included: c.llm_analysis_included,
    s3_status: c.s3?.success ? 'written' : (c.s3?.mock ? 'mock' : 'failed'),
    s3_key: c.s3?.key || null,
  }));
  res.json({ campaigns: recent, total: campaignLog.length, s3_configured: !!s3 });
});

// Revenue simulator
app.post('/api/simulator', (req, res) => {
  const { cohort_key, playbook, budget, target_count } = req.body;
  const allUsers = Object.values(userIndex);
  let targetUsers = allUsers;
  if (cohort_key && cohort_key !== 'all') {
    const cohort = (data.cohorts || []).find(c => c.key === cohort_key);
    if (cohort) {
      targetUsers = allUsers.filter(u => {
        const prob = u.churn_probability || u.risk_score;
        if (cohort_key === 'one_and_done') return u.total_txns <= 1 && u.days_since_last > 30;
        if (cohort_key === 'friction_blocked') return u.fail_rate > 0.1;
        if (cohort_key === 'price_sensitive') return prob > 0.3 && prob < 0.7;
        if (cohort_key === 'dormant') return u.days_since_last > 30;
        return true;
      });
    }
  }
  const maxTarget = Math.min(target_count || targetUsers.length, targetUsers.length);
  targetUsers = targetUsers.sort((a, b) => (b.churn_probability || b.risk_score) - (a.churn_probability || a.risk_score)).slice(0, maxTarget);

  const liftMap = { support_callback: 0.20, speed_guarantee: 0.14, loyalty_discount: 0.16, priority_queue: 0.12, re_engagement: 0.07 };
  const costMap = { support_callback: 3.50, speed_guarantee: 1.20, loyalty_discount: 2.00, priority_queue: 0.50, re_engagement: 0.15 };
  const selectedPlaybook = playbook || 're_engagement';
  const liftRate = liftMap[selectedPlaybook] || 0.10;
  const costPerUser = costMap[selectedPlaybook] || 1.00;

  const totalCost = Math.min(costPerUser * maxTarget, budget || Infinity);
  const affordableUsers = budget ? Math.floor(budget / costPerUser) : maxTarget;
  const actualTarget = Math.min(affordableUsers, maxTarget);
  const avgChurnProb = targetUsers.slice(0, actualTarget).reduce((s, u) => s + (u.churn_probability || u.risk_score), 0) / Math.max(actualTarget, 1);
  const expectedRetained = Math.round(actualTarget * avgChurnProb * liftRate);
  const revenuePerRetained = 8.50 * 2.3; // margin * txns
  const projectedRevenue = Math.round(expectedRetained * revenuePerRetained);
  const projectedCost = Math.round(costPerUser * actualTarget);
  const netProfit = projectedRevenue - projectedCost;

  res.json({
    cohort: cohort_key || 'all',
    playbook: selectedPlaybook,
    target_users: actualTarget,
    avg_churn_probability: Math.round(avgChurnProb * 100) / 100,
    lift_rate: liftRate,
    expected_retained: expectedRetained,
    projected_revenue: projectedRevenue,
    projected_cost: projectedCost,
    net_profit: netProfit,
    roi: Math.round(netProfit / Math.max(projectedCost, 1) * 10) / 10,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// METABASE RAW QUERY PROXY
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/metabase/query', async (req, res) => {
  const { sql, query_key } = req.body;

  try {
    // Named query shortcut
    if (query_key && QUERIES[query_key]) {
      const result = await runRedshiftQuery(query_key);
      return res.json(result);
    }

    // Direct SQL execution
    if (sql) {
      const client = await redshiftPool.connect();
      try {
        const result = await client.query(sql);
        const columns = result.fields.map(f => f.name);
        return res.json({ columns, rows: result.rows, row_count: result.rows.length });
      } finally {
        client.release();
      }
    }

    return res.status(400).json({ error: 'Provide sql or query_key' });
  } catch (e) {
    console.error('Redshift query error:', e.message);
    res.status(500).json({ error: 'Redshift query failed', detail: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI ENDPOINTS (Anthropic Claude)
// ═══════════════════════════════════════════════════════════════════════════════

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
    console.error('AI brief error:', e.message);
    res.json({ brief: fallbackBrief(user) });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const message = req.body.message;
  if (!CFG.AI_KEY) return res.json({ response: fallbackChat(message) });

  const corridorInfo = Object.entries(data.corridor_analysis)
    .map(([name, info]) => `${name}: ${(info.churn_rate * 100).toFixed(1)}% churn (${info.total} users)`)
    .join(', ');
  const tierInfo = Object.entries(data.churn_overview.tiers).map(([t, c]) => `${t}=${c}`).join(' ');
  const interventionInfo = Object.entries(data.interventions)
    .map(([type, info]) => `${type}: ${info.count} users ($${Math.round(info.cost)})`).join(', ');

  // Include live data context if available
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

  const systemPrompt = [
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

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.AI_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, system: systemPrompt, messages: [{ role: 'user', content: message }] }),
    });
    const d = await resp.json();
    res.json({ response: d.content?.[0]?.text || 'No response generated.' });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.json({ response: fallbackChat(message) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LLM RISK INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════════

async function runRiskAnalysis(userId) {
  // Check cache
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
    // Fallback: rule-based risk analysis
    const fallback = {
      risk_signals: (user.reasons || []).map(r => ({ signal: r.description, severity: user.risk_tier === 'CRITICAL' ? 'critical' : user.risk_tier === 'HIGH' ? 'high' : 'medium', evidence: `Score contribution: ${r.weight || 'significant'}` })),
      intervention_plan: {
        primary: { action: intervention.message, channel: intervention.channel.split('+')[0].trim(), timing: 'Within 24h', message_template: intervention.message },
        secondary: { action: 'Follow-up if no response', channel: 'Email', timing: 'Day 3', message_template: `Reminder: ${intervention.message}` },
        tertiary: { action: 'Escalate channel', channel: 'WhatsApp', timing: 'Day 7', message_template: 'We noticed you haven\'t completed a transfer recently. Can we help?' },
      },
      justification: `Rule-based analysis: ${user.risk_tier} risk user with ${((user.churn_probability || user.risk_score) * 100).toFixed(0)}% churn probability. Primary driver: ${user.reasons?.[0]?.description || 'inactivity'}.`,
      urgency: user.risk_tier === 'CRITICAL' ? 'immediate' : user.risk_tier === 'HIGH' ? 'this_week' : 'this_month',
      confidence: 0.7,
      source: 'rule_based',
    };
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
      // Parse failed — use rule-based fallback
      const fb = {
        risk_signals: (user.reasons || []).map(r => ({ signal: r.description, severity: user.risk_tier === 'CRITICAL' ? 'critical' : 'high', evidence: 'Rule-based (LLM parse failed)' })),
        intervention_plan: {
          primary: { action: intervention.message, channel: intervention.channel.split('+')[0].trim(), timing: 'Within 24h', message_template: intervention.message },
          secondary: { action: 'Follow-up', channel: 'Email', timing: 'Day 3', message_template: `Reminder: ${intervention.message}` },
          tertiary: { action: 'Escalate', channel: 'WhatsApp', timing: 'Day 7', message_template: 'Can we help with your next transfer?' },
        },
        justification: `Parse fallback for ${user.risk_tier} risk user. ${user.reasons?.[0]?.description || 'Inactivity detected'}.`,
        urgency: user.risk_tier === 'CRITICAL' ? 'immediate' : 'this_week',
        confidence: 0.6, source: 'rule_based_parse_fallback', _ts: Date.now(),
      };
      riskAnalysisCache[userId] = fb;
      return fb;
    }

    analysis.source = 'llm';
    analysis._ts = Date.now();
    riskAnalysisCache[userId] = analysis;
    return analysis;
  } catch (e) {
    console.error('Risk analysis LLM error:', e.message);
    // Fallback
    const fallback = {
      risk_signals: (user.reasons || []).map(r => ({ signal: r.description, severity: user.risk_tier === 'CRITICAL' ? 'critical' : 'high', evidence: 'Rule-based' })),
      intervention_plan: {
        primary: { action: intervention.message, channel: intervention.channel.split('+')[0].trim(), timing: 'Within 24h', message_template: intervention.message },
        secondary: { action: 'Follow-up', channel: 'Email', timing: 'Day 3', message_template: `Reminder: ${intervention.message}` },
        tertiary: { action: 'Escalate', channel: 'WhatsApp', timing: 'Day 7', message_template: 'Can we help with your next transfer?' },
      },
      justification: `Fallback analysis for ${user.risk_tier} risk user. ${user.reasons?.[0]?.description || 'Inactivity detected'}.`,
      urgency: user.risk_tier === 'CRITICAL' ? 'immediate' : 'this_week',
      confidence: 0.65,
      source: 'rule_based_fallback',
      _ts: Date.now(),
    };
    riskAnalysisCache[userId] = fallback;
    return fallback;
  }
}

app.post('/api/ai/risk-analysis', async (req, res) => {
  const { user_id, user_ids } = req.body;
  const ids = user_ids || (user_id ? [user_id] : []);
  if (!ids.length) return res.status(400).json({ error: 'Provide user_id or user_ids' });
  if (ids.length > 20) return res.status(400).json({ error: 'Max 20 users per batch' });

  const results = {};
  for (const uid of ids) {
    const analysis = await runRiskAnalysis(uid);
    if (analysis) {
      const { _ts, ...clean } = analysis;
      results[uid] = clean;
    } else {
      results[uid] = { error: 'User not found' };
    }
  }

  res.json({ analyses: results, count: ids.length, timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION ENDPOINTS (MoEngage, Retell, Mixpanel)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/integrations', (req, res) => {
  function status(key) {
    if (!key) return 'not_configured';
    if (key.startsWith('sk-') || key.startsWith('test_') || key === 'placeholder') return 'configured';
    return 'connected';
  }
  res.json({
    anthropic:  { name: 'Anthropic AI', status: CFG.AI_KEY ? 'connected' : 'not_configured', icon: 'brain' },
    redshift:   { name: 'Redshift',     status: redshiftPool ? 'connected' : 'not_configured', icon: 'database' },
    moengage:   { name: 'MoEngage',     status: status(CFG.MOENGAGE_API_KEY),                 icon: 'bell' },
    retell:     { name: 'Retell.ai',    status: status(CFG.RETELL_API_KEY),                   icon: 'phone' },
    mixpanel:   { name: 'Mixpanel',     status: status(CFG.MIXPANEL_SECRET),                  icon: 'chart' },
    s3:         { name: 'AWS S3',       status: s3 ? 'connected' : 'not_configured',          icon: 'archive' },
  });
});

// MoEngage auth helper — Data API uses Basic(app_id:data_api_key)
function moengageAuth() {
  return 'Basic ' + Buffer.from(`${CFG.MOENGAGE_APP_ID}:${CFG.MOENGAGE_DATA_API_KEY}`).toString('base64');
}

// POST /api/moengage/engage — Send single user intervention via MoEngage
app.post('/api/moengage/engage', async (req, res) => {
  const { user_id, channel, message } = req.body;
  const user = userIndex[user_id];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const intervention = user.intervention || getIntervention(user);

  if (!CFG.MOENGAGE_APP_ID || !CFG.MOENGAGE_DATA_API_KEY) {
    return res.json({ mock: true, message: `[DEMO] Would send ${channel || intervention.channel} to ${user_id}`, intervention, status: 'queued', user_id, channel: channel || intervention.channel });
  }
  try {
    // Step 1: Sync user attributes to MoEngage
    const userResp = await fetch(`${CFG.MOENGAGE_API_URL}/v1/customer/${CFG.MOENGAGE_APP_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': moengageAuth() },
      body: JSON.stringify({
        type: 'customer',
        customer_id: user_id,
        attributes: {
          risk_tier: user.risk_tier,
          churn_probability: user.churn_probability || user.risk_score,
          corridor: user.corridor,
          days_inactive: user.days_since_last,
          total_txns: user.total_txns,
          intervention_type: intervention.type,
          intervention_channel: channel || intervention.channel,
        },
      }),
    });
    const userResult = await userResp.json();

    // Step 2: Track intervention event
    const eventResp = await fetch(`${CFG.MOENGAGE_API_URL}/v1/event/${CFG.MOENGAGE_APP_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': moengageAuth() },
      body: JSON.stringify({
        type: 'event',
        customer_id: user_id,
        actions: [{
          action: 'churn_intervention_triggered',
          attributes: {
            channel: channel || intervention.channel,
            tier: user.risk_tier,
            message: message || intervention.message,
            intervention_type: intervention.type,
          },
        }],
      }),
    });
    const eventResult = await eventResp.json();

    // Log intervention
    interventionLog.push({ id: interventionLog.length + 1, user_id, channel: channel || intervention.channel, tier: user.risk_tier, triggered_at: new Date().toISOString(), status: 'sent', outcome: 'pending', source: 'moengage' });

    // S3 audit trail
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];
    const campaignId = crypto.randomUUID();
    const riskData = riskAnalysisCache[user_id] || null;
    const s3Record = {
      campaign_id: campaignId, triggered_at: now.toISOString(), triggered_by: 'dashboard',
      tier: user.risk_tier, channel_used: 'MoEngage', llm_analysis_included: !!riskData,
      total_targeted: 1,
      users: [{
        user_id, corridor: user.corridor, risk_tier: user.risk_tier,
        churn_probability: user.churn_probability || user.risk_score,
        communication_type: (channel || intervention.channel).toLowerCase().split('+')[0].trim(),
        tool_used: 'moengage', sent_at: now.toISOString(),
        intervention_type: intervention.type, intervention_message: message || intervention.message,
        llm_risk_signals: riskData?.risk_signals || null, llm_justification: riskData?.justification || null,
        status: 'sent', moengage_response: eventResult,
      }],
    };
    const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record);
    campaignLog.push({ ...s3Record, s3: s3Result });

    res.json({ status: 'sent', user_sync: userResult, event: eventResult, user_id, channel: channel || intervention.channel, intervention, s3: s3Result });
  } catch (e) {
    console.error('MoEngage send error:', e.message);
    res.status(500).json({ error: 'MoEngage send failed', detail: e.message });
  }
});

// POST /api/moengage/bulk — Bulk sync + trigger for a risk tier
app.post('/api/moengage/bulk', async (req, res) => {
  const { tier, max_count, channel } = req.body;
  const targetTier = (tier || 'CRITICAL').toUpperCase();
  const maxUsers = Math.min(parseInt(max_count) || 100, 500);
  const targetUsers = Object.values(userIndex).filter(u => u.risk_tier === targetTier).sort((a, b) => b.risk_score - a.risk_score).slice(0, maxUsers);

  if (!CFG.MOENGAGE_APP_ID || !CFG.MOENGAGE_DATA_API_KEY) {
    return res.json({ mock: true, message: `[DEMO] Would send bulk campaign to ${targetUsers.length} ${targetTier} users`, tier: targetTier, targeted: targetUsers.length, sample_users: targetUsers.slice(0, 5).map(u => ({ user_id: u.user_id, score: u.risk_score, intervention: (u.intervention || getIntervention(u)).type })), status: 'queued' });
  }
  try {
    // Bulk sync users to MoEngage with churn attributes
    let synced = 0;
    let errors = 0;
    for (const u of targetUsers) {
      try {
        const intervention = u.intervention || getIntervention(u);
        await fetch(`${CFG.MOENGAGE_API_URL}/v1/customer/${CFG.MOENGAGE_APP_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': moengageAuth() },
          body: JSON.stringify({
            type: 'customer',
            customer_id: u.user_id,
            attributes: {
              risk_tier: u.risk_tier,
              churn_probability: u.churn_probability || u.risk_score,
              corridor: u.corridor,
              days_inactive: u.days_since_last,
              total_txns: u.total_txns,
              intervention_type: intervention.type,
              cohort: u.cohort,
            },
          }),
        });
        synced++;
      } catch { errors++; }
    }

    // Track bulk event
    await fetch(`${CFG.MOENGAGE_API_URL}/v1/event/${CFG.MOENGAGE_APP_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': moengageAuth() },
      body: JSON.stringify({
        type: 'event',
        customer_id: 'system',
        actions: [{
          action: 'bulk_churn_campaign_triggered',
          attributes: { tier: targetTier, users_targeted: synced, channel: channel || 'push' },
        }],
      }),
    });

    // Log interventions
    const now = new Date();
    targetUsers.forEach(u => {
      interventionLog.push({ id: interventionLog.length + 1, user_id: u.user_id, channel: channel || 'push', tier: targetTier, triggered_at: now.toISOString(), status: 'sent', outcome: 'pending', source: 'moengage_bulk' });
    });

    // S3 audit trail — bulk campaign record
    const dateKey = now.toISOString().split('T')[0];
    const campaignId = crypto.randomUUID();
    const s3Record = {
      campaign_id: campaignId, triggered_at: now.toISOString(), triggered_by: 'dashboard',
      tier: targetTier, channel_used: 'MoEngage', llm_analysis_included: false,
      total_targeted: synced,
      users: targetUsers.map(u => {
        const intv = u.intervention || getIntervention(u);
        const riskData = riskAnalysisCache[u.user_id] || null;
        return {
          user_id: u.user_id, corridor: u.corridor, risk_tier: u.risk_tier,
          churn_probability: u.churn_probability || u.risk_score,
          communication_type: (channel || 'push').toLowerCase(), tool_used: 'moengage',
          sent_at: now.toISOString(), intervention_type: intv.type, intervention_message: intv.message,
          llm_risk_signals: riskData?.risk_signals || null, llm_justification: riskData?.justification || null,
          status: 'sent', moengage_response: null,
        };
      }),
    };
    if (s3Record.users.some(u => u.llm_risk_signals)) s3Record.llm_analysis_included = true;
    const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record);
    campaignLog.push({ ...s3Record, s3: s3Result });

    res.json({ status: 'sent', tier: targetTier, targeted: synced, errors, channel: channel || 'push', sample_users: targetUsers.slice(0, 5).map(u => ({ user_id: u.user_id, score: u.risk_score })), s3: s3Result, campaign_id: campaignId });
  } catch (e) {
    console.error('MoEngage bulk error:', e.message);
    res.status(500).json({ error: 'Bulk campaign failed', detail: e.message });
  }
});

app.post('/api/retell/call', async (req, res) => {
  const { user_id, phone } = req.body;
  const user = userIndex[user_id];
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!CFG.RETELL_API_KEY || !CFG.RETELL_AGENT_ID) {
    const intervention = user.intervention || getIntervention(user);
    return res.json({ mock: true, message: `[DEMO] Would call ${phone || 'user phone'} for ${user_id}`, user_id, phone: phone || '+1-XXX-XXX-XXXX', agent_context: { risk_tier: user.risk_tier, churn_probability: user.churn_probability || user.risk_score, primary_reason: user.reasons?.[0]?.description || 'inactivity', intervention: intervention.type }, status: 'queued' });
  }
  try {
    const intervention = user.intervention || getIntervention(user);
    const resp = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CFG.RETELL_API_KEY}` },
      body: JSON.stringify({ agent_id: CFG.RETELL_AGENT_ID, customer_number: phone, agent_prompt_params: { user_name: user_id, corridor: user.corridor, risk_tier: user.risk_tier, churn_probability: ((user.churn_probability || user.risk_score) * 100).toFixed(0) + '%', primary_reason: user.reasons?.[0]?.description || 'inactivity', intervention_type: intervention.type, intervention_message: intervention.message, tenure_days: String(user.tenure_days), total_txns: String(user.total_txns) } }),
    });
    const result = await resp.json();

    // S3 audit trail — call record
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];
    const campaignId = crypto.randomUUID();
    const riskData = riskAnalysisCache[user_id] || null;
    const s3Record = {
      campaign_id: campaignId, triggered_at: now.toISOString(), triggered_by: 'dashboard',
      tier: user.risk_tier, channel_used: 'Retell.ai', llm_analysis_included: !!riskData,
      total_targeted: 1,
      users: [{
        user_id, corridor: user.corridor, risk_tier: user.risk_tier,
        churn_probability: user.churn_probability || user.risk_score,
        communication_type: 'phone_call', tool_used: 'retell_ai',
        sent_at: now.toISOString(), intervention_type: intervention.type,
        intervention_message: intervention.message,
        llm_risk_signals: riskData?.risk_signals || null, llm_justification: riskData?.justification || null,
        status: 'sent', retell_response: result,
      }],
    };
    const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record);
    campaignLog.push({ ...s3Record, s3: s3Result });

    res.json({ status: 'call_initiated', call_id: result.call_id, user_id, result, s3: s3Result });
  } catch (e) {
    res.status(500).json({ error: 'Voice call failed', detail: e.message });
  }
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

// ═══════════════════════════════════════════════════════════════════════════════
// FALLBACK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

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
  if (m.includes('early warning') || m.includes('warning'))
    return liveData.early_warnings ? `${liveData.early_warnings.row_count} users with active risk signals (last refresh: ${liveData.last_refresh})` : 'Early warnings require Metabase connection. Data refreshes every 6 hours.';
  if (m.includes('partner'))
    return liveData.partner_performance ? liveData.partner_performance.rows.slice(0, 5).map(p => `${p.partner} (${p.corridor}): ${p.failure_rate_pct}% fail rate, ${p.avg_delivery_min}min avg delivery`).join('\n') : 'Partner data requires Metabase connection.';
  if (m.includes('refresh'))
    return `Last refresh: ${liveData.last_refresh || 'never'}. Use POST /api/refresh to trigger manual refresh. Auto-refreshes every 6 hours.`;
  if (m.includes('intervention') || m.includes('action'))
    return Object.entries(data.interventions).map(([type, info]) => `${type}: ${info.count} users, $${Math.round(info.cost)} cost`).join('\n');
  return `${data.summary.total_users.toLocaleString()} users scored. ${data.backtest.detection_p0p1 * 100}% detection. CRITICAL: ${data.churn_overview.tiers.CRITICAL}, HIGH: ${data.churn_overview.tiers.HIGH}.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  const rsStatus = redshiftPool ? 'CONNECTED (direct)' : 'not configured';
  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║   Aspora Churn Intelligence Platform                 ║
  ║   http://localhost:${PORT}                              ║
  ╠══════════════════════════════════════════════════════╣
  ║   Users: ${String(Object.keys(userIndex).length).padEnd(37)}║
  ║   Model: ${String(data.model?.type || 'Ensemble').padEnd(36)}║
  ║   AUC:   ${String(data.model?.metrics?.test?.auc || data.model?.metrics?.validation?.auc || '—').padEnd(36)}║
  ║   Redshift: ${rsStatus.padEnd(33)}║
  ║   Mixpanel: ${(CFG.MIXPANEL_SECRET ? 'CONNECTED' : 'not configured').padEnd(33)}║
  ╠══════════════════════════════════════════════════════╣
  ║   API: 27 endpoints | Auto-refresh: 6h              ║
  ║   Integrations: Anthropic, Redshift, MoEngage,      ║
  ║     Retell.ai, Mixpanel, S3                          ║
  ║   S3 Audit: ${(s3 ? 'CONNECTED' : 'not configured').padEnd(33)}║
  ╚══════════════════════════════════════════════════════╝
  `);

  // Initial data refresh (5s after startup)
  if (redshiftPool) {
    setTimeout(() => {
      console.log('[Auto-Refresh] Running initial data pull from Redshift...');
      refreshAllData();
    }, 5000);
    setInterval(refreshAllData, REFRESH_INTERVAL);
  }

  // Mixpanel data refresh (8s after startup, staggered from Metabase)
  if (CFG.MIXPANEL_SECRET) {
    setTimeout(() => {
      console.log('[Auto-Refresh] Running initial data pull from Mixpanel...');
      refreshMixpanelData();
    }, 8000);
    setInterval(refreshMixpanelData, REFRESH_INTERVAL);
  }
});
