const fs = require('fs');
const path = require('path');
const { DRIFT_CFG } = require('../config');
const { createLogger } = require('../lib/logger');
const log = createLogger('drift');

const REPORT_PATH = path.join(__dirname, '..', '..', 'data', 'retrain_report.json');

// Track consecutive degradation runs for governance
let consecutiveDegradations = 0;

/**
 * Check model drift from retrain_report.json.
 * Uses configurable thresholds (DRIFT_CFG) — not hardcoded.
 * Alerts only when AUC drops > dropThresholdPct for consecutiveRuns.
 */
function checkDrift() {
  if (!fs.existsSync(REPORT_PATH)) {
    return { drifted: false, alert: false, metrics: null, source: 'no_report' };
  }

  try {
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    const currentAuc = report.current_auc || report.metrics?.test?.auc || report.metrics?.validation?.auc;

    if (!currentAuc) {
      return { drifted: false, alert: false, metrics: report.metrics, source: 'no_auc' };
    }

    const dropPct = ((DRIFT_CFG.baselineAuc - currentAuc) / DRIFT_CFG.baselineAuc) * 100;
    const isDegraded = dropPct > DRIFT_CFG.dropThresholdPct;

    if (isDegraded) {
      consecutiveDegradations++;
    } else {
      consecutiveDegradations = 0;
    }

    const shouldAlert = consecutiveDegradations >= DRIFT_CFG.consecutiveRuns;

    // Feature-level drift alerts
    const featureAlerts = (report.drift_alerts || []).filter(
      a => Math.abs(a.z_score) >= DRIFT_CFG.featureZThreshold
    );

    const result = {
      drifted: isDegraded,
      alert: shouldAlert,
      current_auc: currentAuc,
      baseline_auc: DRIFT_CFG.baselineAuc,
      drop_pct: Math.round(dropPct * 100) / 100,
      consecutive_degradations: consecutiveDegradations,
      threshold: { drop_pct: DRIFT_CFG.dropThresholdPct, consecutive_runs: DRIFT_CFG.consecutiveRuns },
      feature_drift: featureAlerts,
      model_version: report.model_version,
      model_swapped: report.model_swapped,
      calibration: report.calibration,
      source: 'retrain_report',
    };

    if (shouldAlert) {
      log.warn('DRIFT ALERT: consecutive degradation threshold reached', {
        auc: currentAuc, drop_pct: result.drop_pct, runs: consecutiveDegradations,
      });
    }

    return result;
  } catch (e) {
    log.warn('Drift check failed', { error: e.message.slice(0, 80) });
    return { drifted: false, alert: false, error: e.message, source: 'read_error' };
  }
}

module.exports = { checkDrift };
