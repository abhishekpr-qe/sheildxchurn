const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');

const { CFG, REFRESH_INTERVAL } = require('./config');
const { data, userIndex } = require('./services/cache');
const { redshiftPool, refreshAllData, initPredictionsTable } = require('./services/redshift');
const { refreshMixpanelData } = require('./services/mixpanel');
const { s3 } = require('./services/campaign');
const { initCooldownTable, loadCooldownsFromDB } = require('./services/cooldown');
const { checkDrift } = require('./services/drift');
const { createLogger } = require('./lib/logger');
const log = createLogger('server');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/', rateLimit({ windowMs: 60000, max: 100 }));
  app.use('/api/metabase/query', rateLimit({ windowMs: 60000, max: 10 }));

  // Request tracing: attach unique ID and log request/response timing
  let reqCounter = 0;
  app.use('/api/', (req, res, next) => {
    req.id = `r${++reqCounter}`;
    const start = Date.now();
    res.on('finish', () => {
      log.info('request', { req_id: req.id, method: req.method, path: req.originalUrl, status: res.statusCode, duration_ms: Date.now() - start });
    });
    next();
  });

  app.use(function(req, res, next) { res.set('Cache-Control', 'no-store'); next(); });

  // Serve frontend
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Register routes
  require('./routes/data')(app);
  require('./routes/live')(app);
  require('./routes/cohorts')(app);
  require('./routes/dossier')(app);
  require('./routes/campaigns')(app);
  require('./routes/ai')(app);
  require('./routes/plotline')(app);
  require('./routes/predictions')(app);

  app.get('/healthz', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  // Swagger UI
  const spec = yaml.load(fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));

  return app;
}

// Start server when run directly (not when imported for testing)
if (require.main === module) {
  const app = createApp();
  const PORT = process.env.PORT || 3001;

  app.listen(PORT, () => {
    log.info('server started', {
      port: PORT,
      users: Object.keys(userIndex).length,
      model: data.model?.type || 'Ensemble',
      auc: data.model?.metrics?.test?.auc || data.model?.metrics?.validation?.auc || null,
      redshift: redshiftPool ? 'connected' : 'not_configured',
      mixpanel: CFG.MIXPANEL_SECRET ? 'connected' : 'not_configured',
      s3: s3 ? 'connected' : 'not_configured',
    });

    initCooldownTable()
      .then(() => loadCooldownsFromDB())
      .catch(e => log.warn('Cooldown init failed', { error: e.message }));

    initPredictionsTable()
      .catch(e => log.warn('Predictions table init failed', { error: e.message }));

    if (redshiftPool) {
      setTimeout(() => {
        log.info('Starting initial Redshift refresh');
        refreshAllData().then(() => {
          const drift = checkDrift();
          if (drift.alert) log.warn('MODEL DRIFT ALERT', drift);
        });
      }, 5000);
      setInterval(() => {
        refreshAllData().then(() => {
          const drift = checkDrift();
          if (drift.alert) log.warn('MODEL DRIFT ALERT', drift);
        });
      }, REFRESH_INTERVAL);
    }

    if (CFG.MIXPANEL_SECRET) {
      setTimeout(() => {
        log.info('Starting initial Mixpanel refresh');
        refreshMixpanelData();
      }, 8000);
      setInterval(refreshMixpanelData, REFRESH_INTERVAL);
    }
  });
}

module.exports = { createApp };
