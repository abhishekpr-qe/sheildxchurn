const { validateTier, validateLimit, validateSearch } = require('../../lib/validate');

// Test the validation logic used in data routes
// (Direct route testing requires full server setup; we test the validation layer)

describe('data route validation patterns', () => {
  test('tier validation accepts valid tiers', () => {
    expect(validateTier('CRITICAL')).toBe('CRITICAL');
    expect(validateTier('high')).toBe('HIGH');
  });

  test('tier validation rejects invalid tiers', () => {
    expect(validateTier('SUPER_HIGH')).toBeNull();
  });

  test('limit defaults correctly', () => {
    expect(validateLimit(undefined, 500)).toBeNull();
    expect(validateLimit('50', 500)).toBe(50);
    expect(validateLimit('1000', 500)).toBe(500);
  });

  test('search sanitization', () => {
    expect(validateSearch('user_123')).toBe('user_123');
    expect(validateSearch('a'.repeat(200))).toBe('a'.repeat(100));
  });
});
