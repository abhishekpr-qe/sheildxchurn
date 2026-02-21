const { Pool } = require('pg');
const { QUERIES } = require('../../queries');
const { liveData } = require('./cache');
const { createLogger } = require('../lib/logger');
const log = createLogger('redshift');

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

async function refreshAllData() {
  const ts = new Date().toISOString();
  log.info('Starting data refresh');

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
      log.info('Query refreshed', { query: key, rows: result.row_count, durationSec: Math.round((Date.now()-start)/1000) });
    } catch (e) {
      const isSkip = key === 'prediction_validation' || key === 'pricing';
      liveData.refresh_status[key] = { status: isSkip ? 'skipped' : 'error', error: e.message, at: ts };
      log.warn('Query refresh failed', { query: key, error: e.message.slice(0, 80), skipped: isSkip });
    }
  }

  liveData.last_refresh = ts;
  log.info('Refresh complete');
}

module.exports = { redshiftPool, runRedshiftQuery, refreshAllData };
