const { Pool } = require('pg');
const { QUERIES, DDL_LLM_USAGE_TABLE_PG, DDL_ADD_RULE_VERSION, DDL_ADD_TOP_REASONS } = require('../../queries');
const { liveData, rebuildFromLiveData } = require('./cache');
const { createLogger } = require('../lib/logger');
const log = createLogger('redshift');

// Production Redshift — data queries (transactions, corridor health, etc.)
const redshiftPool = new Pool({
  host: process.env.REDSHIFT_HOST,
  port: parseInt(process.env.REDSHIFT_PORT || '5439'),
  user: process.env.REDSHIFT_USER,
  password: process.env.REDSHIFT_PASSWORD,
  database: process.env.REDSHIFT_DB || 'dev',
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 120000,
  connectionTimeoutMillis: 120000,
});

// Local PostgreSQL — predictions + LLM usage tables
const localPgPool = process.env.LOCAL_PG_HOST ? new Pool({
  host: process.env.LOCAL_PG_HOST,
  port: parseInt(process.env.LOCAL_PG_PORT || '5439'),
  user: process.env.LOCAL_PG_USER,
  password: process.env.LOCAL_PG_PASSWORD,
  database: process.env.LOCAL_PG_DB || 'churndb',
  max: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000,
}) : null;

async function runRedshiftQuery(queryKey, { reqId } = {}) {
  const rlog = reqId ? createLogger('redshift', { req_id: reqId }) : log;
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

let refreshInProgress = false;

async function refreshAllData() {
  if (refreshInProgress) {
    log.warn('Refresh already in progress — skipping');
    return;
  }
  refreshInProgress = true;
  const ts = new Date().toISOString();
  log.info('Starting data refresh');

  const allQueries = [
    'corridor_health', 'early_warnings', 'delivery',
    'monthly_trends', 'partner_performance', 'new_user_cohorts',
    'decagon_conversations', 'backtest', 'prediction_validation',
  ];

  for (const key of allQueries) {
    try {
      const start = Date.now();
      const result = await runRedshiftQuery(key);
      liveData[key] = result;
      liveData.refresh_status[key] = { status: 'ok', rows: result.row_count, at: ts };
      log.info('Query refreshed', { query: key, rows: result.row_count, durationSec: Math.round((Date.now()-start)/1000) });
    } catch (e) {
      const isSkip = key === 'prediction_validation' || key === 'pricing';
      liveData.refresh_status[key] = { status: isSkip ? 'skipped' : 'error', error: e.message.slice(0, 80), at: ts };
      log.warn('Query refresh failed', { query: key, error: e.message.slice(0, 80), skipped: isSkip });
    }
  }

  liveData.last_refresh = ts;
  rebuildFromLiveData();
  refreshInProgress = false;
  log.info('Refresh complete');
}

// ── Predictions Table (local PostgreSQL) ──

async function initPredictionsTable() {
  if (!localPgPool) {
    log.warn('Local PG not configured — predictions/LLM tables not created');
    return;
  }
  const client = await localPgPool.connect();
  try {
    // Predictions table already exists; ensure rule_version + top_reasons columns are present
    await client.query(DDL_ADD_RULE_VERSION);
    await client.query(DDL_ADD_TOP_REASONS);
    log.info('Predictions table ready');
  } catch (e) {
    log.warn('Predictions table DDL', { error: e.message.slice(0, 120) });
  }
  try {
    await client.query(DDL_LLM_USAGE_TABLE_PG);
    log.info('LLM usage table ready');
  } catch (e) {
    log.warn('LLM usage table DDL', { error: e.message.slice(0, 120) });
  }
  client.release();
}

/**
 * Idempotent batch write: DELETE existing rows for same (user_id, model_version)
 * in a transaction, then INSERT fresh rows. Prevents duplicates on pipeline retry.
 */
async function writePredictions(predictions, modelVersion, ruleVersion) {
  if (!localPgPool || !predictions.length) return { written: 0, errors: 0 };

  const BATCH_SIZE = 500;
  let written = 0, errors = 0;

  for (let i = 0; i < predictions.length; i += BATCH_SIZE) {
    const batch = predictions.slice(i, i + BATCH_SIZE);
    const userIds = batch.map(p => `'${p.user_id}'`).join(',');

    const client = await localPgPool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `DELETE FROM churn_predictions
         WHERE user_id IN (${userIds}) AND model_version = '${modelVersion}'`
      );

      const values = batch.map(p => {
        const reasons = (p.top_reasons || '').replace(/'/g, "''");
        return `('${p.user_id}', NOW(), '${p.risk_tier || ''}', ${p.churn_probability || 0}, ` +
          `${p.risk_score || 0}, '${modelVersion}', '${ruleVersion || ''}', ` +
          `'${p.corridor || ''}', ${p.days_since_last || 0}, ${p.total_txns || 0}, ` +
          `'${p.intervention_type || ''}', '${reasons}')`;
      }).join(',\n');

      await client.query(
        `INSERT INTO churn_predictions
         (user_id, predicted_at, risk_tier, churn_probability, risk_score,
          model_version, rule_version, corridor, days_since_last, total_txns, intervention_type, top_reasons)
         VALUES ${values}`
      );

      await client.query('COMMIT');
      written += batch.length;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      log.error('Predictions write failed', { batch: i, error: e.message.slice(0, 100) });
      errors += batch.length;
    } finally {
      client.release();
    }
  }

  log.info('Predictions written', { written, errors, total: predictions.length, model: modelVersion });
  return { written, errors };
}

/**
 * Evaluate predictions: compare 60-90 day old predictions against actual txn activity.
 * Joins predictions (local PG) against orders (prod Redshift) via subquery.
 * Falls back to local-only evaluation if Redshift unavailable.
 */
async function evaluatePredictions(windowDays = 60) {
  if (!localPgPool) return { evaluated: 0, source: 'unavailable' };

  // Fetch completed user_ids from production Redshift
  let completedUsers = new Set();
  try {
    const rsClient = await redshiftPool.connect();
    try {
      const result = await rsClient.query(`
        SELECT DISTINCT user_id FROM analytics_orders_master_data
        WHERE og_status = 'COMPLETED'
          AND created_at >= DATEADD(day, -${windowDays * 2}, GETDATE())`);
      completedUsers = new Set(result.rows.map(r => r.user_id));
    } finally {
      rsClient.release();
    }
  } catch (e) {
    log.warn('Redshift unavailable for evaluation — marking all as churned', { error: e.message.slice(0, 80) });
  }

  // Update predictions in local PG
  const pgClient = await localPgPool.connect();
  try {
    const pending = await pgClient.query(`
      SELECT id, user_id FROM churn_predictions
      WHERE actual_outcome IS NULL
        AND predicted_at <= NOW() - INTERVAL '${windowDays} days'
        AND predicted_at >= NOW() - INTERVAL '${Math.floor(windowDays * 1.5)} days'`);

    let evaluated = 0;
    for (const row of pending.rows) {
      const outcome = completedUsers.has(row.user_id) ? 'retained' : 'churned';
      await pgClient.query(
        `UPDATE churn_predictions SET actual_outcome = $1, outcome_evaluated_at = NOW() WHERE id = $2`,
        [outcome, row.id]
      );
      evaluated++;
    }

    log.info('Predictions evaluated', { evaluated, window_days: windowDays });
    return { evaluated, window_days: windowDays, timestamp: new Date().toISOString() };
  } finally {
    pgClient.release();
  }
}

// ── LLM Cost Persistence (local PostgreSQL) ──

async function recordLlmUsage(entry) {
  if (!localPgPool) return;
  const client = await localPgPool.connect();
  try {
    await client.query(
      `INSERT INTO churn_llm_usage (model, tier, input_tokens, output_tokens, cost_usd, req_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.model, entry.tier, entry.inputTokens, entry.outputTokens, entry.costUsd, entry.reqId || '', entry.userId || '']
    );
  } catch (e) {
    log.warn('LLM usage write failed', { error: e.message.slice(0, 80) });
  } finally {
    client.release();
  }
}

async function queryLlmUsage(days = 30) {
  if (!localPgPool) return { rows: [], source: 'unavailable' };
  const client = await localPgPool.connect();
  try {
    const result = await client.query(`
      SELECT tier, model, COUNT(*) AS calls,
             SUM(input_tokens) AS total_input, SUM(output_tokens) AS total_output,
             ROUND(CAST(SUM(cost_usd) AS numeric), 4) AS total_cost
      FROM churn_llm_usage
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY tier, model
      ORDER BY total_cost DESC`);
    return { rows: result.rows, days, timestamp: new Date().toISOString() };
  } finally {
    client.release();
  }
}

module.exports = {
  redshiftPool, localPgPool, runRedshiftQuery, refreshAllData,
  initPredictionsTable, writePredictions, evaluatePredictions,
  recordLlmUsage, queryLlmUsage,
};
