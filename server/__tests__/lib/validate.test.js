const { validateTier, validateCorridor, validateLimit, validateSearch, sanitizeId, VALID_TIERS } = require('../../lib/validate');

describe('validateTier', () => {
  test('returns uppercase tier for valid input', () => {
    expect(validateTier('critical')).toBe('CRITICAL');
    expect(validateTier('HIGH')).toBe('HIGH');
    expect(validateTier('Medium')).toBe('MEDIUM');
    expect(validateTier('low')).toBe('LOW');
  });

  test('returns null for invalid tier', () => {
    expect(validateTier('EXTREME')).toBeNull();
    expect(validateTier('')).toBeNull();
    expect(validateTier(null)).toBeNull();
    expect(validateTier(undefined)).toBeNull();
  });
});

describe('validateCorridor', () => {
  test('returns valid corridor', () => {
    expect(validateCorridor('UK → India')).toBe('UK → India');
  });

  test('returns null for invalid corridor', () => {
    expect(validateCorridor('Mars → Jupiter')).toBeNull();
    expect(validateCorridor('')).toBeNull();
    expect(validateCorridor(null)).toBeNull();
  });
});

describe('validateLimit', () => {
  test('returns clamped integer for valid input', () => {
    expect(validateLimit('50')).toBe(50);
    expect(validateLimit('1000', 500)).toBe(500);
    expect(validateLimit('1')).toBe(1);
  });

  test('returns null for invalid input', () => {
    expect(validateLimit('0')).toBeNull();
    expect(validateLimit('-5')).toBeNull();
    expect(validateLimit('abc')).toBeNull();
    expect(validateLimit(undefined)).toBeNull();
  });
});

describe('validateSearch', () => {
  test('returns truncated string', () => {
    expect(validateSearch('hello')).toBe('hello');
    expect(validateSearch('a'.repeat(200), 100)).toBe('a'.repeat(100));
  });

  test('returns empty for invalid input', () => {
    expect(validateSearch(null)).toBe('');
    expect(validateSearch(undefined)).toBe('');
    expect(validateSearch('')).toBe('');
  });
});

describe('sanitizeId', () => {
  test('allows alphanumeric, hyphens, underscores', () => {
    expect(sanitizeId('user-123')).toBe('user-123');
    expect(sanitizeId('user_abc_456')).toBe('user_abc_456');
  });

  test('rejects special characters', () => {
    expect(sanitizeId('user; DROP TABLE')).toBeNull();
    expect(sanitizeId('<script>')).toBeNull();
    expect(sanitizeId('')).toBeNull();
    expect(sanitizeId(null)).toBeNull();
  });
});

describe('VALID_TIERS', () => {
  test('exports expected tiers', () => {
    expect(VALID_TIERS).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  });
});
