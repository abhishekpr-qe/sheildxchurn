const { localPgPool } = require('./redshift');
const { createLogger } = require('../lib/logger');
const log = createLogger('rule-evolution');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RULES_PATH = path.join(__dirname, '..', 'rules.yaml');
const PROJECT_ROOT = path.join(__dirname, '..', '..');

/**
 * Analyze rule effectiveness by comparing predictions vs actual outcomes.
 * Returns per-rule precision/recall and identifies gaps.
 */
async function analyzeRules() {
  if (!localPgPool) return { error: 'Local PG not configured' };

  const client = await localPgPool.connect();
  try {
    // Fetch evaluated predictions with outcomes
    const { rows } = await client.query(`
      SELECT user_id, risk_tier, churn_probability, actual_outcome,
             top_reasons, intervention_type, rule_version
      FROM churn_predictions
      WHERE actual_outcome IS NOT NULL
        AND outcome_evaluated_at IS NOT NULL
      ORDER BY outcome_evaluated_at DESC
      LIMIT 10000`);

    if (!rows.length) {
      return { evaluated: 0, message: 'No evaluated predictions yet. Run POST /api/predictions/evaluate first.' };
    }

    // Parse rule signals from top_reasons (stored as comma-separated reason codes)
    const ruleStats = {};
    let totalChurned = 0;
    let totalRetained = 0;
    let missedChurns = 0; // Churned but predicted LOW/MEDIUM
    let falseAlarms = 0;  // Predicted CRITICAL/HIGH but retained

    for (const row of rows) {
      const churned = row.actual_outcome === 'churned';
      if (churned) totalChurned++;
      else totalRetained++;

      // Missed churns: user churned but we predicted low risk
      if (churned && (row.risk_tier === 'LOW' || row.risk_tier === 'MEDIUM')) {
        missedChurns++;
      }

      // False alarms: predicted high risk but user retained
      if (!churned && (row.risk_tier === 'CRITICAL' || row.risk_tier === 'HIGH')) {
        falseAlarms++;
      }

      // Track per-reason effectiveness
      const reasons = (row.top_reasons || '').split(',').map(r => r.trim()).filter(Boolean);
      for (const reason of reasons) {
        if (!ruleStats[reason]) {
          ruleStats[reason] = { fired: 0, correct: 0, incorrect: 0 };
        }
        ruleStats[reason].fired++;
        if (churned) ruleStats[reason].correct++;
        else ruleStats[reason].incorrect++;
      }
    }

    // Compute per-rule precision
    const ruleAnalysis = Object.entries(ruleStats).map(([reason, stats]) => ({
      reason_code: reason,
      fired: stats.fired,
      correct_churns: stats.correct,
      false_positives: stats.incorrect,
      precision: stats.fired > 0 ? round(stats.correct / stats.fired) : 0,
    })).sort((a, b) => a.precision - b.precision);

    // Tier-level accuracy
    const tierAccuracy = computeTierAccuracy(rows);

    const analysis = {
      evaluated: rows.length,
      total_churned: totalChurned,
      total_retained: totalRetained,
      churn_rate: round(totalChurned / rows.length),
      missed_churns: missedChurns,
      missed_churn_rate: totalChurned > 0 ? round(missedChurns / totalChurned) : 0,
      false_alarms: falseAlarms,
      false_alarm_rate: totalRetained > 0 ? round(falseAlarms / totalRetained) : 0,
      rule_analysis: ruleAnalysis,
      tier_accuracy: tierAccuracy,
      rule_version: rows[0]?.rule_version || 'unknown',
      timestamp: new Date().toISOString(),
    };

    log.info('Rule analysis complete', {
      evaluated: rows.length,
      missed_churns: missedChurns,
      false_alarms: falseAlarms,
      rules_analyzed: ruleAnalysis.length,
    });

    return analysis;
  } finally {
    client.release();
  }
}

function computeTierAccuracy(rows) {
  const tiers = {};
  for (const row of rows) {
    if (!tiers[row.risk_tier]) tiers[row.risk_tier] = { total: 0, churned: 0 };
    tiers[row.risk_tier].total++;
    if (row.actual_outcome === 'churned') tiers[row.risk_tier].churned++;
  }
  return Object.entries(tiers).map(([tier, s]) => ({
    tier,
    total: s.total,
    churned: s.churned,
    retained: s.total - s.churned,
    churn_rate: round(s.churned / s.total),
  }));
}

/**
 * Generate rule change proposals based on outcome analysis.
 * Reads current rules.yaml, compares against analysis, suggests improvements.
 */
async function proposeRuleChanges() {
  const analysis = await analyzeRules();
  if (analysis.error || !analysis.evaluated) return analysis;

  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  const rulesConfig = yaml.load(raw);
  const currentRules = rulesConfig.signal_rules;

  const proposals = [];

  // 1. Weak rules: precision < 0.3 → suggest weight reduction
  for (const rule of analysis.rule_analysis) {
    if (rule.precision < 0.3 && rule.fired >= 10) {
      const match = currentRules.find(r => r.reason_code === rule.reason_code);
      if (match) {
        proposals.push({
          type: 'weight_reduction',
          rule_id: match.id,
          reason: `Low precision ${(rule.precision * 100).toFixed(0)}% (${rule.correct_churns}/${rule.fired} correct)`,
          current_weight: match.weight,
          proposed_weight: round(match.weight * 0.6),
        });
      }
    }
  }

  // 2. Strong rules: precision > 0.7 → suggest weight increase
  for (const rule of analysis.rule_analysis) {
    if (rule.precision > 0.7 && rule.fired >= 10) {
      const match = currentRules.find(r => r.reason_code === rule.reason_code);
      if (match && match.weight < 0.40) {
        proposals.push({
          type: 'weight_increase',
          rule_id: match.id,
          reason: `High precision ${(rule.precision * 100).toFixed(0)}% (${rule.correct_churns}/${rule.fired} correct)`,
          current_weight: match.weight,
          proposed_weight: round(Math.min(match.weight * 1.3, 0.45)),
        });
      }
    }
  }

  // 3. Missed churn rate > 30% → suggest lowering thresholds for key rules
  if (analysis.missed_churn_rate > 0.3) {
    const inactivityRule = currentRules.find(r => r.id === 'inactivity_30d');
    if (inactivityRule) {
      proposals.push({
        type: 'threshold_reduction',
        rule_id: inactivityRule.id,
        reason: `Missed churn rate ${(analysis.missed_churn_rate * 100).toFixed(0)}% — lowering inactivity threshold to catch more churns`,
        current_threshold: inactivityRule.threshold,
        proposed_threshold: Math.max(inactivityRule.threshold - 5, 14),
      });
    }
  }

  // 4. False alarm rate > 50% for CRITICAL/HIGH → suggest raising tier boundary
  const criticalTier = analysis.tier_accuracy.find(t => t.tier === 'CRITICAL');
  if (criticalTier && criticalTier.churn_rate < 0.5) {
    proposals.push({
      type: 'tier_observation',
      reason: `CRITICAL tier has only ${(criticalTier.churn_rate * 100).toFixed(0)}% actual churn — consider raising threshold from 0.80`,
      current_value: 0.80,
      suggested_value: 0.85,
    });
  }

  // 5. New rule proposals for undetected patterns
  if (analysis.missed_churns > 0 && analysis.missed_churn_rate > 0.2) {
    proposals.push({
      type: 'new_rule_suggestion',
      reason: `${analysis.missed_churns} missed churns (${(analysis.missed_churn_rate * 100).toFixed(0)}% miss rate) — consider adding rules for: frequency_drop_gradual (>20% decline over 60d), low_completion_rate (<50%)`,
      suggested_rules: [
        { id: 'gradual_frequency_drop', signal: 'frequency_ratio', operator: 'lte', threshold: 0.5, weight: 0.25, severity: 'high' },
        { id: 'low_completion_rate', signal: 'completion_rate', operator: 'lte', threshold: 0.5, weight: 0.20, severity: 'medium' },
      ],
    });
  }

  return {
    analysis_summary: {
      evaluated: analysis.evaluated,
      missed_churns: analysis.missed_churns,
      false_alarms: analysis.false_alarms,
      rules_analyzed: analysis.rule_analysis.length,
    },
    proposals,
    current_version: rulesConfig.version,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Apply proposed rule changes to rules.yaml, create branch, commit, and open PR.
 * Uses git CLI for branch/commit/push and GitHub REST API for PR creation.
 * GR-009: Never auto-merge. Human review required.
 */
async function applyAndCreatePR(proposals) {
  if (!proposals || !proposals.length) {
    return { error: 'No proposals to apply' };
  }

  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) {
    return { error: 'GITHUB_TOKEN env var required for PR creation' };
  }

  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  const rulesConfig = yaml.load(raw);
  const currentVersion = rulesConfig.version;

  // Bump patch version
  const vParts = currentVersion.split('.');
  vParts[2] = String(parseInt(vParts[2] || '0') + 1);
  const newVersion = vParts.join('.');

  // Apply proposals to rules config
  let appliedCount = 0;
  const changes = [];

  for (const p of proposals) {
    if (p.type === 'weight_reduction' || p.type === 'weight_increase') {
      const rule = rulesConfig.signal_rules.find(r => r.id === p.rule_id);
      if (rule) {
        const old = rule.weight;
        rule.weight = p.proposed_weight;
        changes.push(`${p.rule_id}: weight ${old} → ${p.proposed_weight}`);
        appliedCount++;
      }
    } else if (p.type === 'threshold_reduction') {
      const rule = rulesConfig.signal_rules.find(r => r.id === p.rule_id);
      if (rule) {
        const old = rule.threshold;
        rule.threshold = p.proposed_threshold;
        changes.push(`${p.rule_id}: threshold ${old} → ${p.proposed_threshold}`);
        appliedCount++;
      }
    } else if (p.type === 'new_rule_suggestion' && p.suggested_rules) {
      for (const sr of p.suggested_rules) {
        const exists = rulesConfig.signal_rules.find(r => r.id === sr.id);
        if (!exists) {
          rulesConfig.signal_rules.push({
            id: sr.id,
            signal: sr.signal,
            operator: sr.operator,
            threshold: sr.threshold,
            weight: sr.weight,
            severity: sr.severity,
            reason_code: sr.id,
            intervention: 're_engagement',
            description_template: `${sr.signal} triggered (value: {value})`,
          });
          changes.push(`NEW: ${sr.id} (${sr.signal} ${sr.operator} ${sr.threshold})`);
          appliedCount++;
        }
      }
    }
  }

  if (!appliedCount) {
    return { applied: 0, message: 'No actionable proposals (tier_observation requires manual review)' };
  }

  rulesConfig.version = newVersion;
  const newYaml = yaml.dump(rulesConfig, { lineWidth: 120, noRefs: true });
  const branchName = `feat/rules-v${newVersion}`;

  // Detect current branch and remote
  const gitOpts = { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 15000, stdio: 'pipe' };
  let currentBranch;

  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', gitOpts).toString().trim();

    // Stash any local changes to rules.yaml
    try { execSync('git stash push -m "rule-evolution-temp" -- server/rules.yaml', gitOpts); } catch (_) { /* nothing to stash */ }

    // Create branch, write, commit, push
    execSync(`git checkout -b ${branchName}`, gitOpts);
    fs.writeFileSync(RULES_PATH, newYaml);
    execSync('git add server/rules.yaml', gitOpts);

    const commitMsg = [
      `feat: update rules to v${newVersion}`,
      '',
      'Changes:',
      ...changes.map(c => `- ${c}`),
      '',
      'Generated by rule evolution pipeline.',
      'Human review required (GR-009).',
    ].join('\n');
    fs.writeFileSync(path.join(PROJECT_ROOT, '.git', 'COMMIT_MSG_TEMP'), commitMsg);
    execSync('git commit -F .git/COMMIT_MSG_TEMP', gitOpts);

    execSync(`git push -u origin ${branchName}`, gitOpts);

    // Create PR via GitHub REST API
    const remote = execSync('git remote get-url origin', gitOpts).toString().trim();
    const repoMatch = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    let prUrl = null;

    if (repoMatch) {
      const repo = repoMatch[1];
      const prBody = [
        `## Rule Evolution — v${newVersion}`,
        '',
        'Auto-generated from prediction outcome analysis.',
        '',
        '### Changes',
        ...changes.map(c => `- ${c}`),
        '',
        '### Review Checklist',
        '- [ ] Verify weight changes are reasonable',
        '- [ ] Check threshold adjustments against business rules',
        '- [ ] Validate new rules have correct signals',
        '- [ ] Confirm no breaking changes to existing scoring',
        '',
        '> GR-009: Never auto-merge rule changes.',
      ].join('\n');

      const resp = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          title: `feat: rules v${newVersion} — ${appliedCount} changes`,
          body: prBody,
          head: branchName,
          base: 'main',
        }),
      });

      if (resp.ok) {
        const prData = await resp.json();
        prUrl = prData.html_url;
      } else {
        const errBody = await resp.text().catch(() => '');
        log.warn('GitHub PR creation failed', { status: resp.status, body: errBody.slice(0, 200) });
        prUrl = `branch pushed: ${branchName} (PR creation failed: ${resp.status})`;
      }
    }

    // Return to original branch and restore stash
    execSync(`git checkout ${currentBranch}`, gitOpts);
    try { execSync('git stash pop', gitOpts); } catch (_) { /* no stash */ }

    log.info('Rule evolution PR created', { version: newVersion, applied: appliedCount, branch: branchName, pr: prUrl });

    return {
      applied: appliedCount,
      version: newVersion,
      branch: branchName,
      changes,
      pr_url: prUrl,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    // Recover: return to original branch, restore rules.yaml
    try {
      if (currentBranch) execSync(`git checkout ${currentBranch} 2>/dev/null || true`, { ...gitOpts, stdio: 'pipe' });
      try { execSync('git stash pop 2>/dev/null || true', { ...gitOpts, stdio: 'pipe' }); } catch (_) {}
      fs.writeFileSync(RULES_PATH, raw);
    } catch (_) { /* best effort recovery */ }

    log.error('Rule evolution PR failed', { error: e.message?.slice(0, 120) });
    return { error: 'PR creation failed', detail: e.message?.slice(0, 200), changes };
  }
}

function round(v, d = 4) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

module.exports = { analyzeRules, proposeRuleChanges, applyAndCreatePR };
