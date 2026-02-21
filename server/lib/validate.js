/**
 * Input validation helpers for API routes.
 * @module lib/validate
 */
const { DOMAIN } = require('../config');

const VALID_TIERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** @param {string} val @returns {string|null} Validated tier or null */
function validateTier(val) {
  if (!val) return null;
  const upper = String(val).toUpperCase();
  return VALID_TIERS.includes(upper) ? upper : null;
}

/** @param {string} val @returns {string|null} Validated corridor or null */
function validateCorridor(val) {
  if (!val) return null;
  return (DOMAIN.CORRIDORS || []).includes(val) ? val : null;
}

/** @param {*} val @param {number} max @returns {number|null} Clamped integer or null */
function validateLimit(val, max = 500) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1) return null;
  return Math.min(n, max);
}

/** @param {string} val @param {number} maxLen @returns {string} Truncated string */
function validateSearch(val, maxLen = 100) {
  if (!val || typeof val !== 'string') return '';
  return val.slice(0, maxLen);
}

/** @param {string} val @returns {string|null} Sanitized ID or null */
function sanitizeId(val) {
  if (!val || typeof val !== 'string') return null;
  return /^[a-zA-Z0-9_-]+$/.test(val) ? val : null;
}

module.exports = { validateTier, validateCorridor, validateLimit, validateSearch, sanitizeId, VALID_TIERS };
