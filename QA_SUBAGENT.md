# QA_SUBAGENT.md

## Purpose

Run a pre-submission QA pass so your team can fix issues before final upload.

This is a self-check workflow (team-side), not the official final judging run.

---

## What this QA pass should verify

1. Setup reproducibility from clean environment
2. Build/start works
3. Each `SOLUTION.md` claim is testable and mapped in `RUNBOOK.md`
4. Basic error/edge-case behavior is handled
5. Documentation and runtime behavior are consistent

---

## Severity definitions

Every finding must be classified into one of three severity levels:

| Severity | Definition | Examples |
|----------|------------|----------|
| **Critical** | Submission cannot be evaluated. Evaluator is blocked. | Setup/build fails. App doesn't start. Missing required files. Real secrets committed. |
| **Major** | A claimed feature doesn't work or can't be verified. | Claimed endpoint returns 500. RUNBOOK step produces wrong result. AI feature is cosmetic/unused. No verification steps for a claim. |
| **Minor** | Doesn't block evaluation but reduces quality. | Typos in docs. Placeholder text left in templates. Missing edge-case handling. Inconsistent naming. |

---

## Pass/fail thresholds

Use these thresholds to determine the overall QA status:

| Status | Criteria |
|--------|----------|
| **ready** | 0 critical findings. 0 major findings. Minor findings are acceptable. |
| **partial** | 0 critical findings. 1-2 major findings with documented workarounds. |
| **blocked** | 1+ critical findings. OR 3+ major findings. Submission should NOT be zipped until resolved. |

### Per-claim result definitions

| Result | When to use |
|--------|-------------|
| **pass** | Claim verified end-to-end. Evidence captured (output, screenshot, log). |
| **fail** | Claim tested but does not work as described. Include actual vs expected. |
| **blocked** | Cannot test — setup dependency missing, env var not set, external service unavailable. |
| **not_tested** | Claim exists but no verification step in RUNBOOK, or time-constrained. Flag as a gap. |

---

## Inputs

- `README.md`
- `PROBLEM.md`
- `SOLUTION.md`
- `RUNBOOK.md`
- source code
- `.env.example`

---

## Expected outputs (team internal)

- `QA_SELF_CHECK.md` (human-readable)
- `QA_SELF_CHECK.json` (structured)
- `PROJECT_UNDERSTANDING.md` (short summary of how the QA agent understood the problem and solution)

### Suggested JSON shape

```json
{
  "status": "ready|partial|blocked",
  "counts": {
    "critical": 0,
    "major": 0,
    "minor": 0
  },
  "project_understanding": {
    "problem_summary": "string",
    "solution_summary": "string",
    "assumptions": ["string"],
    "open_questions": ["string"]
  },
  "claims": [
    {
      "claim": "string",
      "result": "pass|fail|blocked|not_tested",
      "severity": "critical|major|minor",
      "evidence": ["string"],
      "fix_hint": "string"
    }
  ],
  "findings": [
    {
      "area": "setup|build|run|docs|security",
      "severity": "critical|major|minor",
      "description": "string",
      "fix_hint": "string"
    }
  ],
  "missing_items": ["string"],
  "runbook_gaps": ["string"],
  "summary": "string"
}
```

---

## Sample prompt (Codex CLI) — QA self-check

Run from project root:

```bash
codex exec --full-auto "
Perform a pre-submission QA self-check using QA_SUBAGENT.md.
Read README.md, PROBLEM.md, SOLUTION.md, RUNBOOK.md and source code.
First, produce a concise understanding of:
- the problem this project is solving
- the proposed solution and key claims
Then validate setup/build/run and each claimed feature.
Create:
1) PROJECT_UNDERSTANDING.md
2) QA_SELF_CHECK.md
3) QA_SELF_CHECK.json
Mark each claim as pass/fail/blocked/not_tested and suggest concrete fixes.
Include assumptions and open questions in both PROJECT_UNDERSTANDING.md and QA_SELF_CHECK.json.
"
```

---

## Exit criteria before zipping

- **0 critical findings** — setup, build, and start must work from clean environment
- **0-2 major findings** — each must have a documented workaround or be listed as a known limitation in SOLUTION.md
- Project/problem/solution understanding is documented (with assumptions + open questions)
- Every SOLUTION.md claim has a corresponding verification step in RUNBOOK.md
- No placeholder/template text left in submission docs
- QA status is `ready` or `partial` (never `blocked`)
