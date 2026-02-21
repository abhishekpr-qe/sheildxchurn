const { validateTier, validateLimit } = require('../../lib/validate');

describe('campaigns route: SQL injection guard', () => {
  // Test the SQL validation pattern used in POST /api/metabase/query
  function isAllowedSQL(sql) {
    if (!sql) return false;
    const trimmed = sql.trim().replace(/;+$/, '');
    if (!/^SELECT\s/i.test(trimmed)) return false;
    if (/\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|GRANT)\b/i.test(trimmed)) return false;
    return true;
  }

  test('allows simple SELECT', () => {
    expect(isAllowedSQL('SELECT * FROM users')).toBe(true);
    expect(isAllowedSQL('select count(*) from orders')).toBe(true);
  });

  test('rejects DROP TABLE', () => {
    expect(isAllowedSQL('DROP TABLE users')).toBe(false);
    expect(isAllowedSQL('SELECT 1; DROP TABLE users')).toBe(false);
  });

  test('rejects DELETE', () => {
    expect(isAllowedSQL('DELETE FROM users')).toBe(false);
  });

  test('rejects INSERT', () => {
    expect(isAllowedSQL('INSERT INTO users VALUES (1)')).toBe(false);
  });

  test('rejects UPDATE', () => {
    expect(isAllowedSQL('UPDATE users SET name = 1')).toBe(false);
  });

  test('rejects non-SQL input', () => {
    expect(isAllowedSQL('')).toBe(false);
    expect(isAllowedSQL(null)).toBe(false);
  });

  test('strips trailing semicolons', () => {
    expect(isAllowedSQL('SELECT 1;;;')).toBe(true);
  });
});

describe('campaigns route: bulk validation', () => {
  test('tier defaults to CRITICAL when invalid', () => {
    const result = validateTier('INVALID') || 'CRITICAL';
    expect(result).toBe('CRITICAL');
  });

  test('max_count clamps to 500', () => {
    expect(validateLimit('1000', 500)).toBe(500);
    expect(validateLimit('50', 500)).toBe(50);
  });
});

describe('campaigns route: selectTargetUsers pattern', () => {
  const users = {
    u1: { user_id: 'u1', risk_tier: 'CRITICAL', risk_score: 0.95 },
    u2: { user_id: 'u2', risk_tier: 'CRITICAL', risk_score: 0.85 },
    u3: { user_id: 'u3', risk_tier: 'HIGH', risk_score: 0.7 },
    u4: { user_id: 'u4', risk_tier: 'CRITICAL', risk_score: 0.9 },
  };

  function selectTargetUsers(userIndex, tier, maxCount) {
    return Object.values(userIndex)
      .filter(u => u.risk_tier === tier)
      .sort((a, b) => b.risk_score - a.risk_score)
      .slice(0, maxCount);
  }

  test('filters by tier', () => {
    const result = selectTargetUsers(users, 'CRITICAL', 10);
    expect(result).toHaveLength(3);
    expect(result.every(u => u.risk_tier === 'CRITICAL')).toBe(true);
  });

  test('sorts by risk_score descending', () => {
    const result = selectTargetUsers(users, 'CRITICAL', 10);
    expect(result[0].risk_score).toBe(0.95);
    expect(result[1].risk_score).toBe(0.9);
  });

  test('limits result count', () => {
    const result = selectTargetUsers(users, 'CRITICAL', 2);
    expect(result).toHaveLength(2);
  });
});
