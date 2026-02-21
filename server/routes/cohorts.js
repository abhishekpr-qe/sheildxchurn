const { data } = require('../services/cache');

module.exports = function(app) {

  app.get('/api/cohorts', (req, res) => {
    res.json(data.cohorts || []);
  });

  app.get('/api/cohorts/:key', (req, res) => {
    const cohort = (data.cohorts || []).find(c => c.key === req.params.key);
    if (!cohort) return res.status(404).json({ error: 'Cohort not found' });
    res.json(cohort);
  });

  app.get('/api/cohorts/:key/playbook', (req, res) => {
    const cohort = (data.cohorts || []).find(c => c.key === req.params.key);
    if (!cohort) return res.status(404).json({ error: 'Cohort not found' });
    res.json({
      cohort: cohort.label,
      description: cohort.description,
      count: cohort.count,
      churn_rate: cohort.churn_rate,
      retention_strategy: cohort.retention_strategy,
      sample_users: cohort.sample_users,
    });
  });

};
