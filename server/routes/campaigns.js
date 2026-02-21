const crypto = require('crypto');
const { CFG, getIntervention, DOMAIN, MARGIN_PER_TXN, LTV_MULTIPLIER, DEFAULT_LIMITS, SIMULATOR_DEFAULTS, PRICE_SENSITIVE_RANGE } = require('../config');
const { data, userIndex, campaignLog, interventionLog, riskAnalysisCache } = require('../services/cache');
const { writeToS3, s3 } = require('../services/campaign');
const { getCooldown, setCooldown, removeCooldown, getCooldownStatus, getActiveCooldowns, acquireLock } = require('../services/cooldown');
const { syncUserAttributes, trackEvent, sendMoEngagePush } = require('../services/moengage');
const { redshiftPool, runRedshiftQuery } = require('../services/redshift');
const { QUERIES } = require('../../queries');
const { validateTier, validateLimit } = require('../lib/validate');
const { createLogger } = require('../lib/logger');
const log = createLogger('campaigns');

/**
 * Select and sort target users for a campaign by risk tier.
 * @param {Object} userIndex - User index object
 * @param {string} tier - Risk tier to filter
 * @param {number} maxCount - Maximum users to return
 * @returns {Array} Sorted array of target users
 */
function selectTargetUsers(userIndex, tier, maxCount) {
  return Object.values(userIndex)
    .filter(u => u.risk_tier === tier)
    .sort((a, b) => b.risk_score - a.risk_score)
    .slice(0, maxCount);
}

async function withConcurrency(items, fn, limit = 10) {
  let synced = 0, errors = 0;
  for (let i = 0; i < items.length; i += limit) {
    const results = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    results.forEach(r => r.status === 'fulfilled' ? synced++ : errors++);
  }
  return { synced, errors };
}

module.exports = function(app) {

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
    const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record, { reqId: req.id });
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
    res.json(interventionLog.slice(-DEFAULT_LIMITS.intervention_log));
  });

  // GET /api/campaigns/history — Recent campaign audit trail
  app.get('/api/campaigns/history', (req, res) => {
    const recent = campaignLog.slice(-DEFAULT_LIMITS.campaign_history).reverse().map(c => ({
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
          if (cohort_key === 'price_sensitive') return prob > PRICE_SENSITIVE_RANGE.min && prob < PRICE_SENSITIVE_RANGE.max;
          if (cohort_key === 'dormant') return u.days_since_last > 30;
          return true;
        });
      }
    }
    const maxTarget = Math.min(target_count || targetUsers.length, targetUsers.length);
    targetUsers = targetUsers.sort((a, b) => (b.churn_probability || b.risk_score) - (a.churn_probability || a.risk_score)).slice(0, maxTarget);

    // Build lift/cost maps from single source of truth
    const liftMap = {};
    const costMap = {};
    for (const [type, info] of Object.entries(DOMAIN.INTERVENTIONS)) {
      costMap[type] = info.cost;
      const liftMatch = (info.lift || '').match(/(\d+)-(\d+)/);
      liftMap[type] = liftMatch ? (parseInt(liftMatch[1]) + parseInt(liftMatch[2])) / 200 : SIMULATOR_DEFAULTS.lift_rate;
    }
    const selectedPlaybook = playbook || 're_engagement';
    const liftRate = liftMap[selectedPlaybook] || SIMULATOR_DEFAULTS.lift_rate;
    const costPerUser = costMap[selectedPlaybook] || SIMULATOR_DEFAULTS.cost_per_user;

    const totalCost = Math.min(costPerUser * maxTarget, budget || Infinity);
    const affordableUsers = budget ? Math.floor(budget / costPerUser) : maxTarget;
    const actualTarget = Math.min(affordableUsers, maxTarget);
    const avgChurnProb = targetUsers.slice(0, actualTarget).reduce((s, u) => s + (u.churn_probability || u.risk_score), 0) / Math.max(actualTarget, 1);
    const expectedRetained = Math.round(actualTarget * avgChurnProb * liftRate);
    const revenuePerRetained = MARGIN_PER_TXN * LTV_MULTIPLIER;
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

  // GET /api/integrations — Integration status
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

  // POST /api/moengage/engage — Single user intervention with cooldown protection
  app.post('/api/moengage/engage', async (req, res) => {
    const { user_id, channel, message, title } = req.body;
    const user = userIndex[user_id];
    if (!user) return res.status(404).json({ error: 'User not found' });

    let releaseLock;
    try {
      releaseLock = await acquireLock(user_id);
    } catch (e) {
      return res.status(429).json({ error: 'Lock timeout — concurrent request in progress' });
    }

    try {
      // Check cooldown
      const existing = getCooldown(user_id);
      if (existing) {
        const remaining = (new Date(existing.cooldown_until) - new Date()) / (1000 * 60 * 60);
        return res.status(409).json({
          cooldown_active: true,
          remaining_hours: Math.round(remaining * 10) / 10,
          last_action: existing.action_type,
          sent_at: existing.sent_at,
        });
      }

      const intervention = user.intervention || getIntervention(user);
      const usedChannel = channel || intervention.channel;
      const campaignId = crypto.randomUUID();
      const now = new Date();

      const cooldownMeta = {
        action_type: intervention.type,
        channel: usedChannel,
        cohort: user.cohort || null,
        cost: intervention.cost || 0,
        campaign_id: campaignId,
        source: 'moengage',
        corridor: user.corridor,
        risk_tier: user.risk_tier,
        churn_probability: user.churn_probability || user.risk_score,
      };

      // Mock mode — no MoEngage calls, no DB persistence
      if (!CFG.MOENGAGE_APP_ID || !CFG.MOENGAGE_DATA_API_KEY) {
        await setCooldown(user_id, cooldownMeta, { reqId: req.id, persist: false });
        return res.json({ mock: true, message: `[DEMO] Would send ${usedChannel} to ${user_id}`, intervention, status: 'queued', user_id, channel: usedChannel, campaign_id: campaignId });
      }

      // Write cooldown BEFORE MoEngage calls (Fix #6 — crash window)
      await setCooldown(user_id, cooldownMeta, { reqId: req.id });

      try {
        const userAttrs = {
          risk_tier: user.risk_tier,
          churn_probability: user.churn_probability || user.risk_score,
          corridor: user.corridor,
          days_inactive: user.days_since_last,
          total_txns: user.total_txns,
          intervention_type: intervention.type,
          intervention_channel: usedChannel,
        };
        const userResult = await syncUserAttributes(user_id, userAttrs, { reqId: req.id });

        const eventAttrs = {
          channel: usedChannel,
          tier: user.risk_tier,
          message: message || intervention.message,
          intervention_type: intervention.type,
        };
        const eventResult = await trackEvent(user_id, 'churn_intervention_triggered', eventAttrs, { reqId: req.id });

        // Push notification if channel includes push
        let pushResult = null;
        if (usedChannel.toLowerCase().includes('push')) {
          pushResult = await sendMoEngagePush(user, message || intervention.message, title || 'Vance', { reqId: req.id });
        }

        // Log intervention
        interventionLog.push({ id: interventionLog.length + 1, user_id, channel: usedChannel, tier: user.risk_tier, triggered_at: now.toISOString(), status: 'sent', outcome: 'pending', source: 'moengage' });

        // S3 audit trail
        const dateKey = now.toISOString().split('T')[0];
        const riskData = riskAnalysisCache[user_id] || null;
        const s3Record = {
          campaign_id: campaignId, triggered_at: now.toISOString(), triggered_by: 'dashboard',
          tier: user.risk_tier, channel_used: 'MoEngage', llm_analysis_included: !!riskData,
          total_targeted: 1,
          users: [{
            user_id, corridor: user.corridor, risk_tier: user.risk_tier,
            churn_probability: user.churn_probability || user.risk_score,
            communication_type: usedChannel.toLowerCase().split('+')[0].trim(),
            tool_used: 'moengage', sent_at: now.toISOString(),
            intervention_type: intervention.type, intervention_message: message || intervention.message,
            llm_risk_signals: riskData?.risk_signals || null, llm_justification: riskData?.justification || null,
            status: 'sent', moengage_response: eventResult,
          }],
        };
        const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record, { reqId: req.id });
        campaignLog.push({ ...s3Record, s3: s3Result });

        res.json({ status: 'sent', user_sync: userResult, event: eventResult, push: pushResult, user_id, channel: usedChannel, intervention, s3: s3Result, campaign_id: campaignId });
      } catch (e) {
        // Rollback cooldown on MoEngage failure (Fix #6)
        await removeCooldown(user_id, { reqId: req.id });
        log.error('MoEngage send error', { req_id: req.id, error: e.message });
        res.status(500).json({ error: 'MoEngage send failed', detail: e.message });
      }
    } finally {
      if (releaseLock) releaseLock();
    }
  });

  // POST /api/moengage/bulk — Bulk sync + trigger with cooldown filtering
  app.post('/api/moengage/bulk', async (req, res) => {
    const { tier, max_count, channel } = req.body;
    const targetTier = validateTier(tier) || 'CRITICAL';
    const maxUsers = validateLimit(max_count, 500) || 100;
    const allCandidates = selectTargetUsers(userIndex, targetTier, maxUsers);

    // Filter out users with active cooldowns
    const bulkSkipped = [];
    const targetUsers = allCandidates.filter(u => {
      if (getCooldown(u.user_id)) { bulkSkipped.push(u.user_id); return false; }
      return true;
    });

    const campaignId = crypto.randomUUID();
    const now = new Date();
    const usedChannel = channel || 'push';

    // Mock mode — in-memory cooldowns only
    if (!CFG.MOENGAGE_APP_ID || !CFG.MOENGAGE_DATA_API_KEY) {
      await withConcurrency(targetUsers, async u => {
        const intv = u.intervention || getIntervention(u);
        await setCooldown(u.user_id, {
          action_type: intv.type, channel: usedChannel, cohort: u.cohort || null,
          cost: intv.cost || 0, campaign_id: campaignId, source: 'moengage_bulk',
          corridor: u.corridor, risk_tier: u.risk_tier,
          churn_probability: u.churn_probability || u.risk_score,
        }, { reqId: req.id, persist: false });
      }, 10);
      return res.json({
        mock: true, message: `[DEMO] Would send bulk campaign to ${targetUsers.length} ${targetTier} users`,
        tier: targetTier, targeted: targetUsers.length, skipped_cooldown: bulkSkipped.length,
        sample_users: targetUsers.slice(0, 5).map(u => ({ user_id: u.user_id, score: u.risk_score, intervention: (u.intervention || getIntervention(u)).type })),
        status: 'queued', campaign_id: campaignId,
      });
    }

    try {
      // Bounded-parallel sync to MoEngage (Fix #3)
      const syncResult = await withConcurrency(targetUsers, async u => {
        const intv = u.intervention || getIntervention(u);
        await syncUserAttributes(u.user_id, {
          risk_tier: u.risk_tier,
          churn_probability: u.churn_probability || u.risk_score,
          corridor: u.corridor,
          days_inactive: u.days_since_last,
          total_txns: u.total_txns,
          intervention_type: intv.type,
          cohort: u.cohort,
        }, { reqId: req.id });
      }, 10);

      // Track bulk event
      await trackEvent('system', 'bulk_churn_campaign_triggered', {
        tier: targetTier, users_targeted: syncResult.synced, channel: usedChannel,
      }, { reqId: req.id });

      // Log interventions
      targetUsers.forEach(u => {
        interventionLog.push({ id: interventionLog.length + 1, user_id: u.user_id, channel: usedChannel, tier: targetTier, triggered_at: now.toISOString(), status: 'sent', outcome: 'pending', source: 'moengage_bulk' });
      });

      // S3 audit trail
      const dateKey = now.toISOString().split('T')[0];
      const s3Record = {
        campaign_id: campaignId, triggered_at: now.toISOString(), triggered_by: 'dashboard',
        tier: targetTier, channel_used: 'MoEngage', llm_analysis_included: false,
        total_targeted: syncResult.synced,
        users: targetUsers.map(u => {
          const intv = u.intervention || getIntervention(u);
          const riskData = riskAnalysisCache[u.user_id] || null;
          return {
            user_id: u.user_id, corridor: u.corridor, risk_tier: u.risk_tier,
            churn_probability: u.churn_probability || u.risk_score,
            communication_type: usedChannel.toLowerCase(), tool_used: 'moengage',
            sent_at: now.toISOString(), intervention_type: intv.type, intervention_message: intv.message,
            llm_risk_signals: riskData?.risk_signals || null, llm_justification: riskData?.justification || null,
            status: 'sent', moengage_response: null,
          };
        }),
      };
      if (s3Record.users.some(u => u.llm_risk_signals)) s3Record.llm_analysis_included = true;
      const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record, { reqId: req.id });
      campaignLog.push({ ...s3Record, s3: s3Result });

      // Set cooldowns after successful sync (bounded-parallel)
      await withConcurrency(targetUsers, async u => {
        const intv = u.intervention || getIntervention(u);
        await setCooldown(u.user_id, {
          action_type: intv.type, channel: usedChannel, cohort: u.cohort || null,
          cost: intv.cost || 0, campaign_id: campaignId, source: 'moengage_bulk',
          corridor: u.corridor, risk_tier: u.risk_tier,
          churn_probability: u.churn_probability || u.risk_score,
        }, { reqId: req.id });
      }, 10);

      res.json({
        status: 'sent', tier: targetTier, targeted: syncResult.synced,
        errors: syncResult.errors, skipped_cooldown: bulkSkipped.length,
        channel: usedChannel,
        sample_users: targetUsers.slice(0, 5).map(u => ({ user_id: u.user_id, score: u.risk_score })),
        s3: s3Result, campaign_id: campaignId,
      });
    } catch (e) {
      log.error('MoEngage bulk error', { req_id: req.id, error: e.message });
      res.status(500).json({ error: 'Bulk campaign failed', detail: e.message });
    }
  });

  // GET /api/cooldown/active — All active cooldowns (admin)
  app.get('/api/cooldown/active', (req, res) => {
    const active = getActiveCooldowns();
    res.json({ active: active.length, cooldowns: active });
  });

  // GET /api/cooldown/:userId — Cooldown status for a specific user
  app.get('/api/cooldown/:userId', (req, res) => {
    const status = getCooldownStatus(req.params.userId);
    res.json(status);
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
      const s3Result = await writeToS3(`campaigns/${dateKey}/${campaignId}.json`, s3Record, { reqId: req.id });
      campaignLog.push({ ...s3Record, s3: s3Result });

      res.json({ status: 'call_initiated', call_id: result.call_id, user_id, result, s3: s3Result });
    } catch (e) {
      res.status(500).json({ error: 'Voice call failed', detail: e.message });
    }
  });

  // POST /api/metabase/query — Redshift query proxy
  app.post('/api/metabase/query', async (req, res) => {
    const { sql, query_key } = req.body;

    try {
      // Named query shortcut
      if (query_key && QUERIES[query_key]) {
        const result = await runRedshiftQuery(query_key, { reqId: req.id });
        return res.json(result);
      }

      // Direct SQL execution — SELECT-only allowlist
      if (sql) {
        const trimmed = sql.trim().replace(/;+$/, '');
        if (!/^SELECT\s/i.test(trimmed) || /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|GRANT)\b/i.test(trimmed)) {
          return res.status(400).json({ error: 'Only SELECT queries are allowed' });
        }
        const client = await redshiftPool.connect();
        try {
          const result = await client.query(trimmed);
          const columns = result.fields.map(f => f.name);
          return res.json({ columns, rows: result.rows, row_count: result.rows.length });
        } finally {
          client.release();
        }
      }

      return res.status(400).json({ error: 'Provide sql or query_key' });
    } catch (e) {
      log.error('Redshift query error', { error: e.message });
      res.status(500).json({ error: 'Redshift query failed', detail: e.message });
    }
  });

};
