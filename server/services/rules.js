const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../lib/logger');
const log = createLogger('rules');

const RULES_PATH = path.join(__dirname, '..', 'rules.yaml');
let rulesConfig = null;
let ruleVersionHash = null;

const OPS = {
  gte: (v, t) => v >= t,
  lte: (v, t) => v <= t,
  gt:  (v, t) => v > t,
  lt:  (v, t) => v < t,
  eq:  (v, t) => v === t,
};

function loadRules() {
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  rulesConfig = yaml.load(raw);
  ruleVersionHash = `${rulesConfig.version}-${crypto.createHash('md5').update(raw).digest('hex').slice(0, 8)}`;
  log.info('Rules loaded', { count: rulesConfig.signal_rules.length, version: ruleVersionHash });
  return rulesConfig;
}

function getRuleVersion() {
  if (!rulesConfig) loadRules();
  return ruleVersionHash;
}

function evaluateRules(user) {
  if (!rulesConfig) loadRules();

  const matched = [];
  for (const rule of rulesConfig.signal_rules) {
    const val = user[rule.signal];
    if (val === undefined || val === null) continue;

    const op = OPS[rule.operator];
    if (!op || !op(val, rule.threshold)) continue;

    matched.push({
      rule_id: rule.id,
      signal: rule.signal,
      value: val,
      severity: rule.severity,
      weight: rule.weight,
      reason_code: rule.reason_code,
      intervention: rule.intervention,
      description: formatDesc(rule.description_template, val),
    });
  }

  matched.sort((a, b) => b.weight - a.weight);
  const top = matched.slice(0, rulesConfig.scoring.max_reasons);
  const totalWeight = top.reduce((s, m) => s + m.weight, 0);
  const topIntervention = top[0]?.intervention || 're_engagement';

  return { signals: top, topIntervention, totalWeight, ruleVersion: ruleVersionHash };
}

function formatDesc(template, value) {
  const rounded = Math.round(value * 100) / 100;
  return template
    .replace('{value}', String(rounded))
    .replace('{value_pct}', (value * 100).toFixed(1))
    .replace('{drop_pct}', ((1 - value) * 100).toFixed(0));
}

module.exports = { loadRules, evaluateRules, getRuleVersion };
