const { data, liveData } = require('../services/cache');
const { redshiftPool, runRedshiftQuery, refreshAllData } = require('../services/redshift');
const { REFRESH_INTERVAL } = require('../config');

module.exports = function(app) {

  // GET /api/early-warnings — Real-time churn risk signals
  app.get('/api/early-warnings', async (req, res) => {
    if (liveData.early_warnings) {
      return res.json({ source: 'cache', ...liveData.early_warnings });
    }
    // Try live query
    if (redshiftPool) {
      try {
        const result = await runRedshiftQuery('early_warnings', { reqId: req.id });
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
        const result = await runRedshiftQuery('corridor_health', { reqId: req.id });
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
        const result = await runRedshiftQuery('monthly_trends', { reqId: req.id });
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
        const result = await runRedshiftQuery('partner_performance', { reqId: req.id });
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
        const result = await runRedshiftQuery('new_user_cohorts', { reqId: req.id });
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
        const result = await runRedshiftQuery('prediction_validation', { reqId: req.id });
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

};
