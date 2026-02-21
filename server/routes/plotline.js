const crypto = require('crypto');
const { data, userIndex, interventionLog, campaignLog } = require('../services/cache');
const { getCooldown, setCooldown, COOLDOWN_HOURS } = require('../services/cooldown');
const { syncUserAttributes, trackEvent, sendMoEngagePush } = require('../services/moengage');
const { writeToS3 } = require('../services/campaign');
const { getIntervention, CFG } = require('../config');
const { createLogger } = require('../lib/logger');
const log = createLogger('playbook');

const PLOTLINE_API_KEY = 'N2Y5MmEzYTAtNzljYy00Yjk1LWIxZjgtYzBlOWQ3NzdkYTVj';
const PLOTLINE_API_URL = 'https://api.plotline.so/cohort/custom/sync';

// Action cooldown tracking (in-memory, prevents spam on actions)
// Uses same cooldown duration as user cooldowns from cooldown.js (7 days)
const actionCooldowns = new Map();

// Helper for bounded parallel execution
async function withConcurrency(items, fn, limit = 10) {
  let synced = 0, errors = 0;
  for (let i = 0; i < items.length; i += limit) {
    const results = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    results.forEach(r => r.status === 'fulfilled' ? synced++ : errors++);
  }
  return { synced, errors };
}

// Generate nice segment name with date
function generateSegmentName(cohortLabel, actionName, channel) {
  const date = new Date();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = `${monthNames[date.getMonth()]} ${date.getDate()}`;
  const shortAction = actionName.slice(0, 25).replace(/[^a-zA-Z0-9 ]/g, '').trim();
  return `Vance ${cohortLabel} - ${channel.toUpperCase()} - ${shortAction} - ${dateStr}`;
}

// Generate unique cohort ID
function generateCohortId(cohortKey, actionIndex, channel) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `vance_${cohortKey}_${channel}_${actionIndex}_${date}`;
}

// Check if action is on cooldown
function isActionOnCooldown(cohortKey, actionIndex) {
  const key = `${cohortKey}_${actionIndex}`;
  const cooldownUntil = actionCooldowns.get(key);
  if (!cooldownUntil) return { onCooldown: false };

  const now = new Date();
  if (now < cooldownUntil) {
    const remainingMs = cooldownUntil - now;
    const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
    return {
      onCooldown: true,
      remainingHours,
      cooldownUntil: cooldownUntil.toISOString()
    };
  }

  actionCooldowns.delete(key);
  return { onCooldown: false };
}

// Set action cooldown
function setActionCooldown(cohortKey, actionIndex) {
  const key = `${cohortKey}_${actionIndex}`;
  const cooldownUntil = new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000);
  actionCooldowns.set(key, cooldownUntil);
  return cooldownUntil;
}

// Sync to Plotline API
async function syncToPlotline(cohortName, cohortId, members) {
  const payload = {
    action: 'add_members',
    parameters: {
      cohort_name: cohortName,
      cohort_id: cohortId,
      members: members.map(u => ({ distinct_id: u.user_id }))
    }
  };

  const response = await fetch(PLOTLINE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': PLOTLINE_API_KEY
    },
    body: JSON.stringify(payload)
  });

  return response.json();
}

module.exports = function(app) {

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/playbook/execute — Unified: MoEngage Push + Plotline Segment
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/api/playbook/execute', async (req, res) => {
    const { cohort_key, action_index, action_name, channel, message, title } = req.body;

    // Validate inputs
    if (!cohort_key || action_index === undefined) {
      return res.status(400).json({ error: 'cohort_key and action_index are required' });
    }

    const cohort = (data.cohorts || []).find(c => c.key === cohort_key);
    if (!cohort) {
      return res.status(404).json({ error: 'Cohort not found' });
    }

    const action = cohort.retention_strategy?.actions?.[action_index];
    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // Check action cooldown (prevent spam)
    const cooldownStatus = isActionOnCooldown(cohort_key, action_index);
    if (cooldownStatus.onCooldown) {
      return res.status(429).json({
        error: 'Action on cooldown',
        message: `This action was recently executed. Available again in ${cooldownStatus.remainingHours}h.`,
        cooldown_until: cooldownStatus.cooldownUntil,
        remaining_hours: cooldownStatus.remainingHours
      });
    }

    // Get cohort users and filter by user-level cooldowns
    const cohortUsers = cohort.sample_users || [];
    const skippedUsers = [];
    const eligibleUsers = cohortUsers.filter(u => {
      const userCooldown = getCooldown(u.user_id);
      if (userCooldown) {
        skippedUsers.push({ user_id: u.user_id, reason: 'user_cooldown' });
        return false;
      }
      return true;
    });

    if (!eligibleUsers.length) {
      return res.status(400).json({
        error: 'No eligible users',
        message: 'All users in this cohort are on cooldown',
        skipped: skippedUsers.length
      });
    }

    const usedChannel = (channel || action.channel || 'push').toLowerCase();
    const campaignId = crypto.randomUUID();
    const now = new Date();

    // Generate nice segment name
    const segmentName = generateSegmentName(cohort.label, action_name || action.action, usedChannel);
    const segmentId = generateCohortId(cohort_key, action_index, usedChannel);

    log.info('executing playbook action', {
      cohort_key,
      action_index,
      channel: usedChannel,
      eligible_users: eligibleUsers.length,
      skipped_cooldown: skippedUsers.length,
      segment_name: segmentName
    });

    try {
      // ═══════════════════════════════════════════════════════════════════════
      // STEP 1: Send MoEngage Push Notification
      // ═══════════════════════════════════════════════════════════════════════
      let moengageResult = { mock: true, message: 'MoEngage not configured' };

      if (CFG.MOENGAGE_APP_ID && CFG.MOENGAGE_DATA_API_KEY) {
        // Sync user attributes
        await withConcurrency(eligibleUsers, async u => {
          const enrichedUser = userIndex[u.user_id] || u;
          await syncUserAttributes(u.user_id, {
            risk_tier: u.risk_tier || enrichedUser.risk_tier,
            churn_probability: u.churn_probability || enrichedUser.churn_probability,
            corridor: u.corridor || enrichedUser.corridor,
            cohort: cohort_key,
            playbook_action: action_name || action.action,
          }, { reqId: req.id });
        }, 10);

        // Send push notification
        if (usedChannel.includes('push')) {
          const pushMessage = message || action.action || 'You have a special offer waiting!';
          moengageResult = await sendMoEngagePush({
            userIds: eligibleUsers.map(u => u.user_id),
            message: pushMessage,
            title: title || 'Vance',
            campaignName: `playbook_${cohort_key}_${action_index}_${Date.now()}`,
            reqId: req.id,
          });
        }

        // Track event
        await trackEvent('system', 'playbook_action_executed', {
          cohort: cohort_key,
          action_index,
          action_name: action_name || action.action,
          channel: usedChannel,
          users_targeted: eligibleUsers.length,
          segment_name: segmentName,
        }, { reqId: req.id });

      } else {
        moengageResult = {
          mock: true,
          message: `[DEMO] Would send ${usedChannel} to ${eligibleUsers.length} users`
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // STEP 2: Create Plotline Segment
      // ═══════════════════════════════════════════════════════════════════════
      let plotlineResult = { mock: false };
      try {
        plotlineResult = await syncToPlotline(segmentName, segmentId, eligibleUsers);
        plotlineResult.success = true;
      } catch (err) {
        log.error('Plotline sync failed', { error: err.message });
        plotlineResult = { success: false, error: err.message };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // STEP 3: Set Cooldowns (User + Action level)
      // ═══════════════════════════════════════════════════════════════════════

      // Set user-level cooldowns
      await withConcurrency(eligibleUsers, async u => {
        await setCooldown(u.user_id, {
          action_type: action_name || action.action,
          channel: usedChannel,
          cohort: cohort_key,
          campaign_id: campaignId,
          source: 'playbook_execute',
          corridor: u.corridor,
          risk_tier: u.risk_tier,
          churn_probability: u.churn_probability,
        }, { reqId: req.id, persist: !!CFG.PG_HOST });
      }, 10);

      // Set action-level cooldown (prevent re-execution)
      const actionCooldownUntil = setActionCooldown(cohort_key, action_index);

      // ═══════════════════════════════════════════════════════════════════════
      // STEP 4: Log & Audit Trail
      // ═══════════════════════════════════════════════════════════════════════

      // Log interventions
      eligibleUsers.forEach(u => {
        interventionLog.push({
          id: `INT_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          user_id: u.user_id,
          channel: usedChannel,
          campaign: campaignId,
          playbook: `${cohort.label} - ${action.action}`,
          risk_tier: u.risk_tier,
          churn_probability: u.churn_probability,
          triggered_at: now.toISOString(),
          status: 'sent',
          outcome: null,
          source: 'playbook_execute'
        });
      });

      // S3 audit trail
      const dateKey = now.toISOString().split('T')[0];
      const s3Record = {
        campaign_id: campaignId,
        triggered_at: now.toISOString(),
        triggered_by: 'playbook_execute',
        cohort: cohort_key,
        action_index,
        action_name: action_name || action.action,
        channel_used: usedChannel,
        segment_name: segmentName,
        segment_id: segmentId,
        total_targeted: eligibleUsers.length,
        total_skipped: skippedUsers.length,
        moengage_result: moengageResult,
        plotline_result: plotlineResult,
        users: eligibleUsers.map(u => ({
          user_id: u.user_id,
          corridor: u.corridor,
          risk_tier: u.risk_tier,
          churn_probability: u.churn_probability,
        })),
      };
      const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record, { reqId: req.id });
      campaignLog.push({ ...s3Record, s3: s3Result });

      // ═══════════════════════════════════════════════════════════════════════
      // RESPONSE
      // ═══════════════════════════════════════════════════════════════════════
      return res.json({
        success: true,
        campaign_id: campaignId,
        segment_name: segmentName,
        segment_id: segmentId,
        users_targeted: eligibleUsers.length,
        users_skipped: skippedUsers.length,
        channel: usedChannel,
        moengage: moengageResult,
        plotline: plotlineResult,
        cooldown_until: actionCooldownUntil.toISOString(),
        cooldown_hours: COOLDOWN_HOURS,
        s3: s3Result,
      });

    } catch (err) {
      log.error('Playbook execute error', { cohort_key, action_index, error: err.message });
      return res.status(500).json({
        error: 'Playbook execution failed',
        message: err.message
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/playbook/status — Check action cooldown status
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/api/playbook/status/:cohortKey/:actionIndex', (req, res) => {
    const { cohortKey, actionIndex } = req.params;
    const status = isActionOnCooldown(cohortKey, parseInt(actionIndex));
    res.json({
      cohort_key: cohortKey,
      action_index: parseInt(actionIndex),
      ...status
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/playbook/cooldowns — All active action cooldowns
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/api/playbook/cooldowns', (req, res) => {
    const now = new Date();
    const active = [];
    actionCooldowns.forEach((cooldownUntil, key) => {
      if (cooldownUntil > now) {
        const parts = key.split('_');
        const actionIndex = parseInt(parts.pop());
        const cohortKey = parts.join('_');
        active.push({
          cohort_key: cohortKey,
          action_index: actionIndex,
          cooldown_until: cooldownUntil.toISOString(),
          remaining_hours: Math.ceil((cooldownUntil - now) / (1000 * 60 * 60))
        });
      }
    });
    res.json({ active_cooldowns: active.length, cooldowns: active });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/plotline/cohorts — List cohorts with action status
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/api/plotline/cohorts', (req, res) => {
    const cohorts = (data.cohorts || []).map(c => ({
      key: c.key,
      label: c.label,
      user_count: c.sample_users?.length || 0,
      actions: (c.retention_strategy?.actions || []).map((a, idx) => ({
        index: idx,
        action: a.action,
        channel: a.channel,
        timing: a.timing,
        ...isActionOnCooldown(c.key, idx)
      }))
    }));
    res.json(cohorts);
  });

};
