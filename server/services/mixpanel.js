const { CFG, MIXPANEL_FUNNELS } = require('../config');
const { mixpanelData } = require('./cache');
const { createLogger } = require('../lib/logger');
const log = createLogger('mixpanel');

function mixpanelAuth() {
  return `Basic ${Buffer.from(`${CFG.MIXPANEL_SECRET}:`).toString('base64')}`;
}

async function fetchMixpanelFunnel(funnelId, fromDate, toDate) {
  const params = new URLSearchParams({ funnel_id: funnelId, from_date: fromDate, to_date: toDate, unit: 'month' });
  const resp = await fetch(`https://mixpanel.com/api/2.0/funnels?${params}`, {
    headers: { 'Authorization': mixpanelAuth() },
  });
  if (!resp.ok) throw new Error(`Mixpanel ${resp.status}`);
  return resp.json();
}

async function fetchMixpanelEngageStats() {
  const resp = await fetch(`https://mixpanel.com/api/2.0/engage?page_size=1000`, {
    headers: { 'Authorization': mixpanelAuth() },
  });
  if (!resp.ok) throw new Error(`Mixpanel Engage ${resp.status}`);
  const data = await resp.json();

  const total = data.total || 0;
  const results = data.results || [];
  const stats = { total, sample_size: results.length, kyc: {}, push: { enabled: 0, disabled: 0 }, referred: { yes: 0, no: 0 }, countries: {} };

  for (const r of results) {
    const p = r.$properties || {};
    const kyc = (p.user_kyc_status || '').toUpperCase() || 'UNKNOWN';
    stats.kyc[kyc] = (stats.kyc[kyc] || 0) + 1;
    stats.push[p.push_notification ? 'enabled' : 'disabled']++;
    stats.referred[p.is_referred ? 'yes' : 'no']++;
    const cc = p.$country_code || 'OTHER';
    stats.countries[cc] = (stats.countries[cc] || 0) + 1;
  }

  return stats;
}

async function refreshMixpanelData() {
  if (!CFG.MIXPANEL_SECRET) {
    log.info('Not configured, skipping');
    return;
  }

  const ts = new Date().toISOString();
  log.info('Starting Mixpanel refresh');

  const now = new Date();
  const fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const toDate = now.toISOString().split('T')[0];

  const funnelKeys = Object.keys(MIXPANEL_FUNNELS);
  await Promise.all(funnelKeys.map(async (key) => {
    const f = MIXPANEL_FUNNELS[key];
    try {
      const result = await fetchMixpanelFunnel(f.id, fromDate, toDate);
      const dates = result.data || {};
      const latestDate = Object.keys(dates).sort().pop();
      const steps = latestDate ? (dates[latestDate].steps || []) : [];
      const formatted = steps.map((s, i) => ({
        step: i + 1,
        goal: s.goal || s.event,
        count: s.count,
        overall_pct: Math.round((s.overall_conv_ratio || 0) * 1000) / 10,
        step_pct: Math.round((s.step_conv_ratio || 0) * 1000) / 10,
      }));
      mixpanelData.funnels[key] = { name: f.name, funnel_id: f.id, date: latestDate, steps: formatted };
      log.info('Funnel refreshed', { funnel: key, steps: formatted.length });
    } catch (e) {
      log.warn('Funnel refresh failed', { funnel: key, error: e.message.slice(0, 80) });
    }
  }));

  try {
    mixpanelData.engage_stats = await fetchMixpanelEngageStats();
    log.info('Engage stats loaded', { total: mixpanelData.engage_stats.total });
  } catch (e) {
    log.warn('Engage refresh failed', { error: e.message.slice(0, 80) });
  }

  mixpanelData.last_refresh = ts;
  log.info('Mixpanel refresh complete');
}

module.exports = { mixpanelAuth, fetchMixpanelFunnel, refreshMixpanelData };
