const { data, userIndex, liveData, mixpanelData } = require('../services/cache');
const { validateTier, validateCorridor, validateSearch, validateLimit } = require('../lib/validate');
const { DEFAULT_LIMITS } = require('../config');

module.exports = function(app) {

  app.get('/api/data', (req, res) => {
    const limited = Object.assign({}, data);
    limited.at_risk_users  = (data.at_risk_users  || []).slice(0, DEFAULT_LIMITS.at_risk);
    limited.churned_sample = (data.churned_sample || []).slice(0, DEFAULT_LIMITS.churned_sample);
    limited.healthy_sample = (data.healthy_sample || []).slice(0, DEFAULT_LIMITS.healthy_sample);

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
        limited.at_risk_users = liveData.early_warnings.rows.slice(0, DEFAULT_LIMITS.early_warnings).map(r => ({
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

    if (tier && tier !== 'ALL') {
      const validTier = validateTier(tier);
      if (!validTier) return res.status(400).json({ error: 'Invalid tier value' });
      users = users.filter(u => u.risk_tier === validTier);
    }
    if (corridor && corridor !== 'ALL') users = users.filter(u => u.corridor === corridor);
    const safeSearch = validateSearch(search);
    if (safeSearch)                     users = users.filter(u => u.user_id.includes(safeSearch));

    if (sort === 'volume')      users.sort((a, b) => b.total_volume - a.total_volume);
    else if (sort === 'days')   users.sort((a, b) => b.days_since_last - a.days_since_last);
    else                        users.sort((a, b) => b.risk_score - a.risk_score);

    const safeLimit = validateLimit(limit, 500) || DEFAULT_LIMITS.users;
    res.json(users.slice(0, safeLimit));
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

};
