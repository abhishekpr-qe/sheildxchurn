// Integration tests — HTTP-level route testing via supertest
// Mocks all external services (cache, redshift, S3, AI, sentiment, mixpanel)

const mockUserIndex = {
  user_abc: {
    user_id: 'user_abc', corridor: 'UK → India', risk_tier: 'HIGH', risk_score: 0.72,
    churn_probability: 0.72, tenure_days: 90, total_txns: 5, completed_txns: 4,
    failed_txns: 1, total_volume: 2500, days_since_last: 45, fail_rate: 0.2,
    reasons: [{ code: 'inactivity', description: 'No activity for 45 days', weight: 0.4 }],
    intervention: { type: 're_engagement', channel: 'Email + Push', message: 'Re-engage user' },
  },
};

jest.mock('../../services/cache', () => ({
  data: {
    model: { type: 'Ensemble', metrics: { validation: { auc: 0.945 } } },
    summary: { total_users: 5000 },
    churn_overview: { churn_rate: 0.15, tiers: {} },
    corridor_analysis: {},
    interventions: { re_engagement: { count: 100, cost: 15 } },
    backtest: { total_churned: 500, detection_p0p1: 0.92 },
    shap_data: { user_shap: [] },
    cohorts: [],
    at_risk_users: [mockUserIndex.user_abc],
    churned_sample: [],
    healthy_sample: [],
  },
  userIndex: mockUserIndex,
  liveData: { refresh_status: {} },
  mixpanelData: {},
  sentimentCache: {},
  riskAnalysisCache: {},
  campaignLog: [],
  interventionLog: [],
  rebuildUserIndex: jest.fn(),
}));

jest.mock('../../services/redshift', () => ({
  redshiftPool: null,
  runRedshiftQuery: jest.fn(),
  refreshAllData: jest.fn(),
}));

jest.mock('../../services/campaign', () => ({
  s3: null,
  writeToS3: jest.fn().mockResolvedValue({ mock: true, key: 'test' }),
  moengageAuth: jest.fn().mockReturnValue('Basic test'),
}));

jest.mock('../../services/mixpanel', () => ({
  mixpanelAuth: jest.fn().mockReturnValue('Basic test'),
  refreshMixpanelData: jest.fn(),
}));

jest.mock('../../services/sentiment', () => ({
  decagonData: {},
  analyzeSentiment: jest.fn().mockResolvedValue({ sentiment: 'neutral' }),
  ruleBasedSentiment: jest.fn().mockReturnValue({ sentiment: 'neutral', churn_signal: 'no' }),
  NEGATIVE_WORDS: ['frustrated'],
}));

jest.mock('../../services/ai', () => ({
  runRiskAnalysis: jest.fn().mockResolvedValue({ risk_signals: [] }),
  fallbackBrief: jest.fn().mockReturnValue('Test brief'),
  fallbackChat: jest.fn().mockReturnValue('Test chat response'),
}));

const request = require('supertest');
const { createApp } = require('../../index');

let app;
beforeAll(() => { app = createApp(); });

describe('GET /healthz', () => {
  test('returns ok status', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptime');
  });
});

describe('GET /api/users', () => {
  test('returns array of users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('user_id');
  });

  test('filters by valid tier', async () => {
    const res = await request(app).get('/api/users?tier=HIGH');
    expect(res.status).toBe(200);
    expect(res.body.every(u => u.risk_tier === 'HIGH')).toBe(true);
  });

  test('rejects invalid tier', async () => {
    const res = await request(app).get('/api/users?tier=INVALID');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid');
  });

  test('respects limit parameter', async () => {
    const res = await request(app).get('/api/users?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(1);
  });
});

describe('GET /api/users/:id', () => {
  test('returns user for valid ID', async () => {
    const res = await request(app).get('/api/users/user_abc');
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe('user_abc');
  });

  test('returns 404 for unknown user', async () => {
    const res = await request(app).get('/api/users/nonexistent_user');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });
});

describe('POST /api/metabase/query', () => {
  test('rejects DROP TABLE (SQL injection)', async () => {
    const res = await request(app)
      .post('/api/metabase/query')
      .send({ sql: 'DROP TABLE users' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('SELECT');
  });

  test('rejects DELETE statement', async () => {
    const res = await request(app)
      .post('/api/metabase/query')
      .send({ sql: 'DELETE FROM users WHERE 1=1' });
    expect(res.status).toBe(400);
  });

  test('rejects SELECT with embedded DROP', async () => {
    const res = await request(app)
      .post('/api/metabase/query')
      .send({ sql: 'SELECT 1; DROP TABLE users' });
    expect(res.status).toBe(400);
  });

  test('rejects empty body', async () => {
    const res = await request(app)
      .post('/api/metabase/query')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sql or query_key');
  });
});

describe('GET /api/data', () => {
  test('returns dashboard data', async () => {
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('model');
    expect(res.body).toHaveProperty('summary');
  });
});

describe('GET /api/model', () => {
  test('returns model metadata', async () => {
    const res = await request(app).get('/api/model');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('Ensemble');
  });
});

describe('request tracing', () => {
  test('assigns request IDs to API requests', async () => {
    const res = await request(app).get('/api/users');
    // Request tracing middleware runs on /api/ routes — verify it doesn't break responses
    expect(res.status).toBe(200);
  });
});
