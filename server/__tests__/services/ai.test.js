// Mock cache before importing ai.js (cache reads data files at require time)
jest.mock('../../services/cache', () => ({
  data: {
    model: { type: 'Ensemble', metrics: { validation: { auc: 0.945 } }, train_samples: 1000 },
    summary: { total_users: 5000, total_txns: 25000 },
    churn_overview: { churn_rate: 0.15, tiers: { CRITICAL: 100, HIGH: 200, MEDIUM: 300, LOW: 400 } },
    corridor_analysis: { 'UK → India': { churn_rate: 0.12, total: 2000, churned: 240 } },
    interventions: { re_engagement: { count: 100, cost: 15 } },
    backtest: { detection_p0p1: 0.92 },
    shap_data: { user_shap: [] },
  },
  userIndex: {},
  sentimentCache: {},
  riskAnalysisCache: {},
}));

const { buildFallback, fallbackBrief, fallbackChat } = require('../../services/ai');

const mockUser = {
  user_id: 'test_user_1',
  corridor: 'UK → India',
  tenure_days: 90,
  total_txns: 5,
  completed_txns: 4,
  failed_txns: 1,
  total_volume: 2500,
  days_since_last: 45,
  fail_rate: 0.2,
  stuck_rate: 0.05,
  risk_score: 0.72,
  churn_probability: 0.72,
  risk_tier: 'HIGH',
  reasons: [
    { code: 'inactivity', description: 'No activity for 45 days', weight: 0.4 },
    { code: 'failure_rate', description: 'High failure rate', weight: 0.3 },
  ],
  intervention: {
    type: 're_engagement',
    channel: 'Email + Push',
    message: 'Re-engage user',
  },
};

const mockIntervention = {
  type: 're_engagement',
  channel: 'Email + Push',
  message: 'Personalized re-engagement with recent corridor rate improvements',
};

describe('buildFallback', () => {
  test('returns correct shape', () => {
    const result = buildFallback(mockUser, mockIntervention, 'rule_based', 0.7);
    expect(result).toHaveProperty('risk_signals');
    expect(result).toHaveProperty('intervention_plan');
    expect(result).toHaveProperty('intervention_plan.primary');
    expect(result).toHaveProperty('intervention_plan.secondary');
    expect(result).toHaveProperty('intervention_plan.tertiary');
    expect(result).toHaveProperty('justification');
    expect(result).toHaveProperty('urgency');
    expect(result).toHaveProperty('confidence', 0.7);
    expect(result).toHaveProperty('source', 'rule_based');
  });

  test('maps reasons to risk signals', () => {
    const result = buildFallback(mockUser, mockIntervention, 'rule_based', 0.7);
    expect(result.risk_signals).toHaveLength(2);
    expect(result.risk_signals[0].signal).toBe('No activity for 45 days');
    expect(result.risk_signals[0].severity).toBe('high');
  });

  test('handles user with no reasons', () => {
    const noReasons = { ...mockUser, reasons: [] };
    const result = buildFallback(noReasons, mockIntervention, 'test', 0.5);
    expect(result.risk_signals).toEqual([]);
    expect(result.justification).toContain('inactivity');
  });

  test('sets urgency based on risk tier', () => {
    const critical = { ...mockUser, risk_tier: 'CRITICAL' };
    expect(buildFallback(critical, mockIntervention, 'test', 0.7).urgency).toBe('immediate');
    expect(buildFallback(mockUser, mockIntervention, 'test', 0.7).urgency).toBe('this_week');
    const medium = { ...mockUser, risk_tier: 'MEDIUM' };
    expect(buildFallback(medium, mockIntervention, 'test', 0.7).urgency).toBe('this_month');
  });
});

describe('fallbackBrief', () => {
  test('returns string with user info', () => {
    const brief = fallbackBrief(mockUser);
    expect(typeof brief).toBe('string');
    expect(brief).toContain('UK → India');
    expect(brief).toContain('90d tenure');
    expect(brief).toContain('72%');
  });

  test('includes inactivity note for long-inactive users', () => {
    const inactive = { ...mockUser, days_since_last: 90 };
    expect(fallbackBrief(inactive)).toContain('Inactive for 90 days');
  });

  test('includes failure rate for high-fail users', () => {
    const highFail = { ...mockUser, fail_rate: 0.25 };
    expect(fallbackBrief(highFail)).toContain('High failure rate');
  });
});

describe('fallbackChat', () => {
  test('responds to model queries', () => {
    const resp = fallbackChat('What model are you using?');
    expect(resp).toContain('AUC');
  });

  test('responds to churn queries', () => {
    const resp = fallbackChat('What is the churn rate?');
    expect(resp).toContain('churn rate');
  });

  test('responds to generic queries', () => {
    const resp = fallbackChat('hello');
    expect(resp).toContain('users scored');
  });
});
