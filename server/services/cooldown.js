const { Pool } = require('pg');
const { CFG } = require('../config');
const { createLogger } = require('../lib/logger');
const log = createLogger('cooldown');

const COOLDOWN_HOURS = 7 * 24; // 7 days

// PostgreSQL pool — separate from Redshift
const pgPool = CFG.PG_HOST
  ? new Pool({
      host: CFG.PG_HOST,
      port: parseInt(CFG.PG_PORT || '5432'),
      user: CFG.PG_USER,
      password: CFG.PG_PASSWORD,
      database: CFG.PG_DATABASE,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
    })
  : null;

// In-memory cache (warm reads, DB is source of truth)
const cooldownMap = new Map();

// Per-user lock map (prevents concurrent engage for same user)
const lockMap = new Map();

async function initCooldownTable() {
  if (!pgPool) {
    log.warn('PG not configured — cooldowns in-memory only');
    return;
  }
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS sc_cooldowns (
      user_id VARCHAR(64) PRIMARY KEY,
      action_type VARCHAR(30) NOT NULL,
      channel VARCHAR(30),
      sent_at TIMESTAMPTZ NOT NULL,
      cooldown_until TIMESTAMPTZ NOT NULL,
      cohort VARCHAR(50),
      cost FLOAT DEFAULT 0,
      campaign_id VARCHAR(64),
      source VARCHAR(50),
      corridor VARCHAR(30),
      risk_tier VARCHAR(20),
      churn_probability FLOAT
    )
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS idx_sc_cooldowns_until ON sc_cooldowns(cooldown_until)
  `);
  log.info('Cooldown table ready');
}

async function loadCooldownsFromDB({ reqId } = {}) {
  if (!pgPool) return;
  const rlog = reqId ? createLogger('cooldown', { req_id: reqId }) : log;
  const { rows } = await pgPool.query(
    'SELECT * FROM sc_cooldowns WHERE cooldown_until > NOW()'
  );
  for (const row of rows) {
    cooldownMap.set(row.user_id, row);
  }
  rlog.info('Cooldowns loaded', { active: rows.length });
}

function getCooldown(userId) {
  const entry = cooldownMap.get(userId);
  if (!entry) return null;
  if (new Date(entry.cooldown_until) <= new Date()) {
    cooldownMap.delete(userId);
    return null;
  }
  return entry;
}

async function setCooldown(userId, meta, { reqId, persist = true } = {}) {
  const now = new Date();
  const cooldownUntil = new Date(now.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000);
  const entry = {
    user_id: userId,
    action_type: meta.action_type || 'engage',
    channel: meta.channel || 'push',
    sent_at: now.toISOString(),
    cooldown_until: cooldownUntil.toISOString(),
    cohort: meta.cohort || null,
    cost: meta.cost || 0,
    campaign_id: meta.campaign_id || null,
    source: meta.source || 'dashboard',
    corridor: meta.corridor || null,
    risk_tier: meta.risk_tier || null,
    churn_probability: meta.churn_probability || null,
  };

  // DB UPSERT (atomic — fixes race at DB level)
  if (persist && pgPool) {
    await pgPool.query(
      `INSERT INTO sc_cooldowns (user_id, action_type, channel, sent_at, cooldown_until, cohort, cost, campaign_id, source, corridor, risk_tier, churn_probability)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id) DO UPDATE SET
         action_type=$2, channel=$3, sent_at=$4, cooldown_until=$5, cohort=$6,
         cost=$7, campaign_id=$8, source=$9, corridor=$10, risk_tier=$11, churn_probability=$12`,
      [userId, entry.action_type, entry.channel, entry.sent_at, entry.cooldown_until,
       entry.cohort, entry.cost, entry.campaign_id, entry.source, entry.corridor,
       entry.risk_tier, entry.churn_probability]
    );
  }

  cooldownMap.set(userId, entry);
  if (reqId) createLogger('cooldown', { req_id: reqId }).info('Cooldown set', { user_id: userId });
  return entry;
}

async function removeCooldown(userId, { reqId } = {}) {
  if (pgPool) {
    await pgPool.query('DELETE FROM sc_cooldowns WHERE user_id = $1', [userId]);
  }
  cooldownMap.delete(userId);
  if (reqId) createLogger('cooldown', { req_id: reqId }).info('Cooldown removed', { user_id: userId });
}

function getCooldownStatus(userId) {
  const entry = getCooldown(userId);
  if (!entry) return { active: false, remaining_hours: 0, details: null };
  const remaining = (new Date(entry.cooldown_until) - new Date()) / (1000 * 60 * 60);
  return { active: true, remaining_hours: Math.round(remaining * 10) / 10, details: entry };
}

function getActiveCooldowns() {
  const now = new Date();
  const active = [];
  for (const [userId, entry] of cooldownMap) {
    if (new Date(entry.cooldown_until) > now) {
      active.push(entry);
    } else {
      cooldownMap.delete(userId);
    }
  }
  return active;
}

async function acquireLock(userId) {
  // Spin-wait with bounded retries for per-user serialization
  let attempts = 0;
  while (lockMap.has(userId)) {
    if (++attempts > 50) throw new Error(`Lock timeout for ${userId}`);
    await new Promise(r => setTimeout(r, 100));
  }
  lockMap.set(userId, true);
  return () => lockMap.delete(userId);
}

// Periodic cleanup — hourly DB + in-memory sweep (Fix #4)
if (pgPool) {
  setInterval(async () => {
    try {
      const { rowCount } = await pgPool.query('DELETE FROM sc_cooldowns WHERE cooldown_until <= NOW()');
      let memCleaned = 0;
      for (const [userId, entry] of cooldownMap) {
        if (new Date(entry.cooldown_until) <= new Date()) {
          cooldownMap.delete(userId);
          memCleaned++;
        }
      }
      if (rowCount || memCleaned) {
        log.info('Cooldown cleanup', { db_removed: rowCount, mem_removed: memCleaned });
      }
    } catch (e) {
      log.error('Cooldown cleanup failed', { error: e.message });
    }
  }, 60 * 60 * 1000);
}

module.exports = {
  initCooldownTable,
  loadCooldownsFromDB,
  getCooldown,
  setCooldown,
  removeCooldown,
  getCooldownStatus,
  getActiveCooldowns,
  acquireLock,
};
