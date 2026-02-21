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

async function sendMoEngagePush({ userIds, message, title, richImage, campaignName, reqId } = {}) {
  const pushUrl = CFG.MOENGAGE_PUSH_URL || `${CFG.MOENGAGE_API_URL}`;
  const name = campaignName || `churn_push_${Date.now()}`;

  const androidPayload = {
    title: title || 'Vance',
    message,
    defaultAction: { type: 'deeplinking', value: 'https://vance.onelink.me/DYot/0k53ax5c' },
  };
  const iosPayload = {
    title: title || 'Vance',
    message,
    defaultAction: { type: 'deeplinking', value: 'https://vance.onelink.me/DYot/0k53ax5c' },
  };
  if (richImage) {
    androidPayload.richContent = [{ type: 'image', value: richImage }];
    iosPayload.richContent = [{ type: 'image', value: richImage }];
  }

  const isSingle = userIds.length === 1;
  const payload = {
    appId: CFG.MOENGAGE_APP_ID,
    signature: moengagePushSignature(name),
    campaignName: name,
    targetPlatform: ['ANDROID', 'IOS'],
    targetAudience: 'User',
    targetUserAttributes: {
      attribute: 'USER_ATTRIBUTE_UNIQUE_ID',
      comparisonParameter: isSingle ? 'is' : 'in',
      attributeValue: isSingle ? userIds[0] : userIds,
    },
    payload: { ANDROID: androidPayload, IOS: iosPayload },
    campaignDelivery: { type: 'soon' },
    advancedSettings: {
      ttl: { ANDROID: 672 },
      ignoreFC: 'true',
      sendAtHighPriority: 'true',
    },
  };

  const fullUrl = `${pushUrl}/v2/transaction/sendpush`;
  const bodyStr = JSON.stringify(payload);
  log.info('PUSH_REQ', { url: fullUrl, campaignName: name, userIds, targetAudience: 'User' });
  log.info('PUSH_PAYLOAD', { body: bodyStr });

  const resp = await fetchWithRetry(
    fullUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
    },
    { reqId }
  );
  const text = await resp.text();
  log.info('PUSH_RESP', { httpStatus: resp.status, body: text });
  try { return JSON.parse(text); } catch { return { status: resp.status, body: text || '(empty)' }; }
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
