/**
 * Structured JSON logger — additive instrumentation, no behavior changes.
 * @param {string} module - Module name for log context
 * @param {Object} [baseCtx={}] - Base context merged into every log entry (e.g. { req_id })
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
function createLogger(module, baseCtx = {}) {
  return {
    info: (msg, ctx = {}) => console.log(JSON.stringify({ level: 'info', module, msg, ...baseCtx, ...ctx, ts: new Date().toISOString() })),
    warn: (msg, ctx = {}) => console.warn(JSON.stringify({ level: 'warn', module, msg, ...baseCtx, ...ctx, ts: new Date().toISOString() })),
    error: (msg, ctx = {}) => console.error(JSON.stringify({ level: 'error', module, msg, ...baseCtx, ...ctx, ts: new Date().toISOString() })),
  };
}

module.exports = { createLogger };
