// Mock cache before importing sentiment.js (cache reads data files at require time)
jest.mock('../../services/cache', () => ({
  data: { user_sentiment: {} },
  userIndex: {},
  liveData: {},
  sentimentCache: {},
}));

const { ruleBasedSentiment, buildSentimentPrompt, parseSentimentResponse, NEGATIVE_WORDS, PAIN_KEYWORDS } = require('../../services/sentiment');

describe('ruleBasedSentiment', () => {
  const baseConv = {
    summary: '',
    resolution: '',
    user_messages: [],
    created_at: '2026-01-15',
    flow_type: 'chat',
  };

  test('returns frustrated for many negative signals', () => {
    const conv = { ...baseConv, summary: 'frustrated angry upset disappointed stuck delay waiting pending refund' };
    const result = ruleBasedSentiment('user1', [conv]);
    expect(result.sentiment).toBe('frustrated');
    expect(result.churn_signal).toBe('yes');
    expect(result.urgency).toBe('immediate');
  });

  test('returns concerned for single negative signal', () => {
    const conv = { ...baseConv, summary: 'transfer is stuck' };
    const result = ruleBasedSentiment('user1', [conv]);
    expect(result.sentiment).toBe('concerned');
    expect(result.churn_signal).toBe('maybe');
  });

  test('returns neutral for benign text', () => {
    const conv = { ...baseConv, summary: 'Thank you for your help' };
    const result = ruleBasedSentiment('user1', [conv]);
    expect(result.sentiment).toBe('neutral');
    expect(result.churn_signal).toBe('no');
    expect(result.urgency).toBe('monitor');
  });

  test('extracts pain points from keywords', () => {
    const conv = { ...baseConv, summary: 'My transaction failed and the refund is slow' };
    const result = ruleBasedSentiment('user1', [conv]);
    expect(result.pain_points.length).toBeGreaterThan(0);
    expect(result.pain_points).toContain('Transaction failures');
  });

  test('includes conversation details', () => {
    const result = ruleBasedSentiment('user1', [baseConv]);
    expect(result.user_id).toBe('user1');
    expect(result.has_conversations).toBe(true);
    expect(result.conversation_count).toBe(1);
  });
});

describe('buildSentimentPrompt', () => {
  test('returns string prompt with user context', () => {
    const user = { corridor: 'UK → India', tenure_days: 90, total_txns: 5, risk_tier: 'HIGH' };
    const convs = [{ summary: 'Transfer delayed', created_at: '2026-01-15', flow_type: 'chat', user_messages: ['help'], resolution: 'resolved', csat_rating: '4' }];
    const prompt = buildSentimentPrompt(convs, user);
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('UK → India');
    expect(prompt).toContain('Transfer delayed');
  });

  test('handles null user', () => {
    const prompt = buildSentimentPrompt([{ summary: 'test' }], null);
    expect(prompt).toContain('unknown');
  });
});

describe('parseSentimentResponse', () => {
  test('parses valid JSON response', () => {
    const text = '{"sentiment":"negative","pain_points":["slow"],"summary":"Slow transfers","churn_signal":"yes","urgency":"soon"}';
    const result = parseSentimentResponse(text, 'user1', [{ created_at: '2026-01-15', flow_type: 'chat' }]);
    expect(result.sentiment).toBe('negative');
    expect(result.pain_points).toEqual(['slow']);
    expect(result.churn_signal).toBe('yes');
  });

  test('falls back gracefully on invalid JSON', () => {
    const result = parseSentimentResponse('not json at all', 'user1', []);
    expect(result.sentiment).toBe('unknown');
    expect(result.pain_points).toEqual([]);
  });
});

describe('constants', () => {
  test('NEGATIVE_WORDS is a non-empty array', () => {
    expect(Array.isArray(NEGATIVE_WORDS)).toBe(true);
    expect(NEGATIVE_WORDS.length).toBeGreaterThan(0);
  });

  test('PAIN_KEYWORDS is a non-empty object', () => {
    expect(typeof PAIN_KEYWORDS).toBe('object');
    expect(Object.keys(PAIN_KEYWORDS).length).toBeGreaterThan(0);
  });
});
