const { createLogger } = require('../../lib/logger');

describe('createLogger', () => {
  let spy;

  beforeEach(() => {
    spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  test('works without baseCtx (backward-compatible)', () => {
    const log = createLogger('test-mod');
    log.info('hello');
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.level).toBe('info');
    expect(output.module).toBe('test-mod');
    expect(output.msg).toBe('hello');
    expect(output).not.toHaveProperty('req_id');
  });

  test('baseCtx merges into every log entry', () => {
    const log = createLogger('test-mod', { req_id: 'r42' });
    log.info('with context');
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.req_id).toBe('r42');
    expect(output.module).toBe('test-mod');
  });

  test('per-call ctx overrides baseCtx', () => {
    const log = createLogger('test-mod', { req_id: 'r1', env: 'test' });
    log.info('override', { req_id: 'r2' });
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.req_id).toBe('r2');
    expect(output.env).toBe('test');
  });
});
