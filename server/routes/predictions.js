const { writePredictions, evaluatePredictions } = require('../services/redshift');
const { getRuleVersion } = require('../services/rules');
const { getCostSummary } = require('../services/llm-cost');
const { checkDrift } = require('../services/drift');
const { createLogger } = require('../lib/logger');
const log = createLogger('predictions');

module.exports = function(app) {

  // POST /api/predictions/write — Idempotent batch write (DELETE+INSERT per model run)
  app.post('/api/predictions/write', async (req, res) => {
    const { predictions, model_version } = req.body;
    if (!Array.isArray(predictions) || !predictions.length) {
      return res.status(400).json({ error: 'predictions array required' });
    }
    if (!model_version) {
      return res.status(400).json({ error: 'model_version required' });
    }
    try {
      const ruleVersion = getRuleVersion();
      const result = await writePredictions(predictions, model_version, ruleVersion);
      res.json({ ...result, model_version, rule_version: ruleVersion, timestamp: new Date().toISOString() });
    } catch (e) {
      log.error('Predictions write error', { error: e.message });
      res.status(500).json({ error: 'Write failed', detail: e.message });
    }
  });

  // POST /api/predictions/evaluate — Record outcomes (60-day feedback loop)
  app.post('/api/predictions/evaluate', async (req, res) => {
    const { window_days = 60 } = req.body || {};
    try {
      const result = await evaluatePredictions(window_days);
      res.json(result);
    } catch (e) {
      log.error('Predictions evaluate error', { error: e.message });
      res.status(500).json({ error: 'Evaluation failed', detail: e.message });
    }
  });

  // GET /api/predictions/drift — Model drift status with governance
  app.get('/api/predictions/drift', (req, res) => {
    res.json(checkDrift());
  });

  // GET /api/predictions/cost — LLM cost summary (persistent + in-memory)
  app.get('/api/predictions/cost', async (req, res) => {
    try {
      const summary = await getCostSummary();
      res.json(summary);
    } catch (e) {
      res.status(500).json({ error: 'Cost query failed', detail: e.message });
    }
  });

};
