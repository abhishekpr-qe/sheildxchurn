const { writePredictions, evaluatePredictions, localPgPool } = require('../services/redshift');
const { getRuleVersion } = require('../services/rules');
const { getCostSummary } = require('../services/llm-cost');
const { checkDrift } = require('../services/drift');
const { analyzeRules, proposeRuleChanges, applyAndCreatePR } = require('../services/rule-evolution');
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

  // GET /api/predictions/analyze-rules — Analyze rule effectiveness against outcomes
  app.get('/api/predictions/analyze-rules', async (req, res) => {
    try {
      const result = await analyzeRules();
      res.json(result);
    } catch (e) {
      log.error('Rule analysis error', { error: e.message });
      res.status(500).json({ error: 'Analysis failed', detail: e.message });
    }
  });

  // POST /api/predictions/propose-rules — Generate rule change proposals
  app.post('/api/predictions/propose-rules', async (req, res) => {
    try {
      const result = await proposeRuleChanges();
      res.json(result);
    } catch (e) {
      log.error('Rule proposal error', { error: e.message });
      res.status(500).json({ error: 'Proposal failed', detail: e.message });
    }
  });

  // POST /api/predictions/seed-outcomes — Backdate predictions + add dummy outcomes for demo
  app.post('/api/predictions/seed-outcomes', async (req, res) => {
    if (!localPgPool) return res.status(500).json({ error: 'Local PG not configured' });
    const client = await localPgPool.connect();
    try {
      // Backdate predictions to 75 days ago so they fall in the evaluation window
      await client.query(`UPDATE churn_predictions SET predicted_at = NOW() - INTERVAL '75 days' WHERE actual_outcome IS NULL`);

      // Seed realistic outcomes: CRITICAL/HIGH mostly churn, LOW mostly retain
      await client.query(`
        UPDATE churn_predictions SET
          actual_outcome = CASE
            WHEN risk_tier = 'CRITICAL' AND random() < 0.78 THEN 'churned'
            WHEN risk_tier = 'HIGH' AND random() < 0.55 THEN 'churned'
            WHEN risk_tier = 'MEDIUM' AND random() < 0.32 THEN 'churned'
            WHEN risk_tier = 'LOW' AND random() < 0.08 THEN 'churned'
            ELSE 'retained'
          END,
          outcome_evaluated_at = NOW()
        WHERE actual_outcome IS NULL`);

      const { rows } = await client.query(`
        SELECT risk_tier, actual_outcome, COUNT(*) as cnt
        FROM churn_predictions
        WHERE actual_outcome IS NOT NULL
        GROUP BY risk_tier, actual_outcome
        ORDER BY risk_tier, actual_outcome`);

      res.json({ seeded: true, breakdown: rows });
    } finally {
      client.release();
    }
  });

  // POST /api/predictions/apply-rules — Apply proposals and create PR (GR-009: human review)
  app.post('/api/predictions/apply-rules', async (req, res) => {
    const { proposals } = req.body;
    if (!Array.isArray(proposals) || !proposals.length) {
      return res.status(400).json({ error: 'proposals array required (from POST /propose-rules)' });
    }
    try {
      const result = await applyAndCreatePR(proposals);
      res.json(result);
    } catch (e) {
      log.error('Rule apply error', { error: e.message });
      res.status(500).json({ error: 'Apply failed', detail: e.message });
    }
  });

};
