const crypto = require('crypto');
const { CFG } = require('../config');
const { createLogger } = require('../lib/logger');
const log = createLogger('moengage');

function moengageAuth() {
  return 'Basic ' + Buffer.from(`${CFG.MOENGAGE_APP_ID}:${CFG.MOENGAGE_DATA_API_KEY}`).toString('base64');
}

async function fetchWithRetry(url, opts, { reqId, retries = 2 } = {}) {
  const rlog = reqId ? createLogger('moengage', { req_id: reqId }) : log;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
      if (resp.status === 429 || resp.status >= 500) {
        lastError = new Error(`HTTP ${resp.status}`);
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 500;
          rlog.warn('Retrying MoEngage call', { attempt: attempt + 1, status: resp.status, delay });
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw lastError;
      }
      return resp;
    } catch (e) {
      lastError = e;
      if (attempt < retries && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        const delay = Math.pow(2, attempt) * 500;
        rlog.warn('Retrying MoEngage call (timeout)', { attempt: attempt + 1, delay });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (attempt >= retries) throw lastError;
    }
  }
  throw lastError;
}

function moengagePushSignature(campaignName) {
  return crypto.createHash('sha256')
    .update(`${CFG.MOENGAGE_APP_ID}|${campaignName}|${CFG.MOENGAGE_API_KEY}`)
    .digest('hex');
}

async function sendMoEngagePush(user, message, title, { reqId } = {}) {
  const pushUrl = CFG.MOENGAGE_PUSH_URL || CFG.MOENGAGE_API_URL;
  const campaignName = `churn_${user.risk_tier}_${Date.now()}`;
  const payload = {
    app_id: CFG.MOENGAGE_APP_ID,
    signature: moengagePushSignature(campaignName),
    campaign_name: campaignName,
    target_platform: ['ANDROID', 'IOS'],
    target_type: 'customer_id',
    target: [user.user_id],
    delivery: { type: 'soon' },
    ttl: 672,
    ignore_fc: true,
    high_priority: true,
    payload: {
      android: {
        title: title || 'Vance',
        message,
        actions: [{ action_type: 'deepLink', value: 'https://vance.onelink.me/DYot/0k53ax5c' }],
      },
      ios: {
        title: title || 'Vance',
        alert: message,
        actions: [{ action_type: 'deepLink', value: 'https://vance.onelink.me/DYot/0k53ax5c' }],
      },
    },
  };

  const resp = await fetchWithRetry(
    `${pushUrl}/v2/transaction/sendpush`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': moengageAuth(),
      },
      body: JSON.stringify(payload),
    },
    { reqId }
  );
  return resp.json();
}

async function syncUserAttributes(userId, attrs, { reqId } = {}) {
  const resp = await fetchWithRetry(
    `${CFG.MOENGAGE_API_URL}/v1/customer/${CFG.MOENGAGE_APP_ID}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': moengageAuth() },
      body: JSON.stringify({ type: 'customer', customer_id: userId, attributes: attrs }),
    },
    { reqId }
  );
  return resp.json();
}

async function trackEvent(userId, action, attrs, { reqId } = {}) {
  const resp = await fetchWithRetry(
    `${CFG.MOENGAGE_API_URL}/v1/event/${CFG.MOENGAGE_APP_ID}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': moengageAuth() },
      body: JSON.stringify({
        type: 'event',
        customer_id: userId,
        actions: [{ action, attributes: attrs }],
      }),
    },
    { reqId }
  );
  return resp.json();
}

module.exports = {
  fetchWithRetry,
  moengagePushSignature,
  sendMoEngagePush,
  syncUserAttributes,
  trackEvent,
  moengageAuth,
};
