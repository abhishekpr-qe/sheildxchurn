const fs = require('fs');
const path = require('path');
const { createLogger } = require('../lib/logger');
const log = createLogger('csv-loader');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function readCsv(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  if (lines.length < 2) return null;
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });
}

// Handle quoted CSV fields (commas inside quotes)
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && (i === 0 || line[i - 1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function readKeyValue(filename) {
  const rows = readCsv(filename);
  if (!rows) return null;
  const obj = {};
  rows.forEach(r => { obj[r.key || r.metric] = r.value; });
  return obj;
}

function parseNum(v) {
  if (v === '' || v === undefined || v === null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function parseReasons(str) {
  if (!str || str === '[]') return [{ code: 'inactivity', description: 'Reduced activity' }];
  try {
    // Python dict syntax → JSON: replace single quotes with double quotes
    const json = str.replace(/'/g, '"').replace(/True/g, 'true').replace(/False/g, 'false').replace(/None/g, 'null');
    return JSON.parse(json);
  } catch {
    return [{ code: 'inactivity', description: 'Reduced activity' }];
  }
}

function parseIntervention(str) {
  if (!str) return { type: 're_engagement', message: 'Personalized re-engagement', channel: 'Email', cost: 1, lift: '5-10%' };
  try {
    const json = str.replace(/'/g, '"').replace(/True/g, 'true').replace(/False/g, 'false').replace(/None/g, 'null');
    return JSON.parse(json);
  } catch {
    return { type: 're_engagement', message: 'Personalized re-engagement', channel: 'Email', cost: 1, lift: '5-10%' };
  }
}

function loadAllCsvData() {
  log.info('Loading CSV seed data');

  // at_risk_users.csv → data.at_risk_users
  const atRiskRows = readCsv('at_risk_users.csv');
  let atRiskUsers = [];
  if (atRiskRows) {
    atRiskUsers = atRiskRows.map(r => ({
      user_id: r.user_id,
      corridor: r.corridor,
      currency: r.currency,
      tenure_days: parseNum(r.tenure_days),
      total_txns: parseNum(r.total_txns),
      completed_txns: parseNum(r.completed_txns),
      failed_txns: parseNum(r.failed_txns),
      pending_txns: parseNum(r.pending_txns),
      total_volume: parseNum(r.total_volume),
      completed_volume: parseNum(r.completed_volume),
      avg_amount: parseNum(r.avg_amount),
      days_since_last: parseNum(r.days_since_last),
      fail_rate: parseNum(r.fail_rate),
      stuck_rate: parseNum(r.stuck_rate),
      stuck_count: parseNum(r.stuck_count),
      avg_delivery_min: parseNum(r.avg_delivery_min),
      risk_score: parseNum(r.risk_score),
      churn_probability: parseNum(r.churn_probability),
      risk_tier: r.risk_tier || 'LOW',
      reasons: parseReasons(r.reasons),
      intervention: parseIntervention(r.intervention),
      cohort: r.cohort || null,
      first_txn: r.first_txn || null,
      last_txn: r.last_txn || null,
      source: 'csv_seed',
    }));
    log.info('Loaded at_risk_users', { count: atRiskUsers.length });
  }

  // users_all.csv → additional users for userIndex
  const allUserRows = readCsv('users_all.csv');
  let allUsers = [];
  if (allUserRows) {
    allUsers = allUserRows.map(r => ({
      user_id: r.user_id,
      corridor: r.corridor,
      currency: r.currency,
      tenure_days: parseNum(r.tenure_days),
      total_txns: parseNum(r.total_txns),
      completed_txns: parseNum(r.completed_txns),
      failed_txns: parseNum(r.failed_txns),
      pending_txns: parseNum(r.pending_txns),
      total_volume: parseNum(r.total_volume),
      completed_volume: parseNum(r.completed_volume),
      avg_amount: parseNum(r.avg_amount),
      days_since_last: parseNum(r.days_since_last),
      fail_rate: parseNum(r.fail_rate),
      stuck_rate: parseNum(r.stuck_rate),
      stuck_count: parseNum(r.stuck_count),
      avg_delivery_min: parseNum(r.avg_delivery_min),
      risk_score: parseNum(r.risk_score),
      churn_probability: parseNum(r.churn_probability),
      risk_tier: r.risk_tier || 'LOW',
      reasons: parseReasons(r.reasons),
      intervention: parseIntervention(r.intervention),
      cohort: r.cohort || null,
      first_txn: r.first_txn || null,
      last_txn: r.last_txn || null,
      source: 'csv_seed',
    }));
    log.info('Loaded users_all', { count: allUsers.length });
  }

  // summary.csv
  const summary = readKeyValue('summary.csv');

  // corridor_analysis.csv
  const corridorRows = readCsv('corridor_analysis.csv');
  const corridorAnalysis = {};
  if (corridorRows) {
    corridorRows.forEach(r => {
      corridorAnalysis[r.corridor] = {
        total: parseNum(r.total),
        active_30d: parseNum(r.active_30d),
        inactive_30_60d: parseNum(r.inactive_30_60d),
        volume_30d: parseNum(r.volume_30d),
        volume_30_60d: parseNum(r.volume_30_60d),
        success_rate: parseNum(r.success_rate),
        avg_delivery_min: parseNum(r.avg_delivery_min),
        stuck_rate: parseNum(r.stuck_rate),
        churn_rate: parseNum(r.churn_rate),
      };
    });
  }

  // executive_summary.csv
  const exec = readKeyValue('executive_summary.csv');

  // churn_overview.csv
  const churn = readKeyValue('churn_overview.csv');

  // mixpanel_snapshot.csv
  const mixpanel = readKeyValue('mixpanel_snapshot.csv');

  // rollout_status.csv
  const rollout = readKeyValue('rollout_status.csv');

  // transactions.csv → raw transaction rows
  const txnRows = readCsv('transactions.csv');
  let transactions = [];
  if (txnRows) {
    transactions = txnRows.map(r => ({
      user_id: r.user_id,
      send_amount: parseNum(r.send_amount?.replace(/,/g, '')),
      currency_from: r.currency_from,
      og_status: r.og_status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      processing_minutes: parseNum(r.processing_minutes),
    }));
    log.info('Loaded transactions', { count: transactions.length });
  }

  // Compute transaction_status from user-level data (more complete than raw txn CSV)
  const userSource = allUsers.length ? allUsers : atRiskUsers;
  let transactionStatus = null;
  if (userSource.length) {
    let comp = 0, fail = 0, stuck = 0, pending = 0;
    userSource.forEach(u => {
      comp += u.completed_txns || 0;
      fail += u.failed_txns || 0;
      stuck += u.stuck_count || 0;
      pending += u.pending_txns || 0;
    });
    transactionStatus = { COMPLETED: comp, FAILED: fail, STUCK: stuck, PROCESSING: 0, PENDING: pending };
    log.info('Computed transaction_status from users', { users: userSource.length, status: transactionStatus });
  }

  return {
    atRiskUsers,
    allUsers,
    summary: summary ? {
      total_users: parseNum(summary.total_users),
      total_txns: parseNum(summary.total_txns),
      scoring_date: summary.scoring_date,
      data_source: 'csv_seed',
    } : null,
    corridorAnalysis,
    executiveImpact: exec ? {
      total_users: parseNum(exec.total_users),
      active_30d: parseNum(exec.active_30d),
      at_risk: parseNum(exec.at_risk),
      churn_rate_baseline: parseNum(exec.churn_rate_baseline),
      churn_rate_post_intervention: parseNum(exec.churn_rate_post_intervention),
      predicted_churn_30d: parseNum(exec.predicted_churn_30d),
      revenue_at_risk: parseNum(exec.revenue_at_risk),
      retained_saved: parseNum(exec.retained_saved),
      revenue_saved: parseNum(exec.revenue_saved),
      total_intervention_cost: parseNum(exec.intervention_cost),
      monthly_net_benefit: parseNum(exec.net_benefit),
      roi_multiple: parseNum(exec.roi_multiple),
      payback_days: parseNum(exec.payback_days),
      avg_txns_per_user: parseNum(exec.avg_txns_per_user),
      margin_per_txn: parseNum(exec.margin_per_txn),
      ltv_multiplier: parseNum(exec.ltv_multiplier),
      data_source: exec.data_source || 'csv_seed',
    } : null,
    churnOverview: churn ? {
      status: {
        CHURNED: parseNum(churn.status_CHURNED),
        ACTIVE: parseNum(churn.status_ACTIVE),
        AT_RISK: parseNum(exec?.at_risk),
        SOFT_CHURN: parseNum(churn.status_SOFT_CHURN),
        HEALTHY: Math.max(parseNum(churn.status_ACTIVE) - parseNum(exec?.at_risk), 0),
      },
      tiers: {
        CRITICAL: parseNum(churn.tier_CRITICAL),
        HIGH: parseNum(churn.tier_HIGH),
        MEDIUM: parseNum(churn.tier_MEDIUM),
        LOW: parseNum(churn.tier_LOW),
      },
      churn_rate: parseNum(churn.churn_rate),
      soft_churn_rate: parseNum(churn.soft_churn_rate),
    } : null,
    mixpanelSnapshot: mixpanel ? {
      date: mixpanel.date,
      total_events: parseNum(mixpanel.total_events),
      daily_active_users: parseNum(mixpanel.daily_active_users),
      orders_created: parseNum(mixpanel.orders_created),
      orders_completed: parseNum(mixpanel.orders_completed),
      orders_failed: parseNum(mixpanel.orders_failed),
      sessions: parseNum(mixpanel.sessions),
      api_errors: parseNum(mixpanel.api_errors),
      api_timeouts: parseNum(mixpanel.api_timeouts),
      kyc_updated: parseNum(mixpanel.kyc_updated),
      users_signed_up: parseNum(mixpanel.users_signed_up),
      users_created: parseNum(mixpanel.users_created),
      help_screens: parseNum(mixpanel.help_screens),
      chat_clicks: parseNum(mixpanel.chat_clicks),
      transfer_screens: parseNum(mixpanel.transfer_screens),
      review_screens: parseNum(mixpanel.review_screens),
    } : null,
    rollout: rollout ? {
      phase: rollout.phase,
      max: parseNum(rollout.max),
      total_users: parseNum(rollout.total_users),
      utilization: rollout.utilization,
      tiers: {
        CRITICAL: { active: parseNum(rollout.CRITICAL_active), cap: parseNum(rollout.CRITICAL_cap), enabled: rollout.CRITICAL_enabled === 'True' },
        HIGH: { active: parseNum(rollout.HIGH_active), cap: parseNum(rollout.HIGH_cap), enabled: rollout.HIGH_enabled === 'True' },
        MEDIUM: { active: parseNum(rollout.MEDIUM_active), cap: parseNum(rollout.MEDIUM_cap), enabled: rollout.MEDIUM_enabled === 'True' },
        LOW: { active: parseNum(rollout.LOW_active), cap: parseNum(rollout.LOW_cap), enabled: rollout.LOW_enabled === 'True' },
      },
    } : null,
    transactionStatus,
    transactions,
  };
}

module.exports = { loadAllCsvData };
