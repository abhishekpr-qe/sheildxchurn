# INSTRUCTIONS.md

## Aspora AI Hackathon — External Submission Flow

Follow this exact 4-step flow.

---

## Step 1) Initialize submission docs + structure

Use:
- `SUBMISSION_TEMPLATE_INIT.md`

This creates the required files and starter content:
- `README.md`
- `PROBLEM.md`
- `SOLUTION.md`
- `RUNBOOK.md`
- `.env.example`

> Important: template content is only a starting point. You must replace it with your real project context.

---

## Step 2) Fill in your real problem/solution/runbook

What you claim in `SOLUTION.md` will be verified by evaluators.

Minimum expectations:
- `PROBLEM.md` clearly states real problem + user/business context
- `SOLUTION.md` lists explicit features/claims (checklist style)
- `RUNBOOK.md` has exact run + verify steps from clean environment

---

## Step 3) Run QA self-check before final submission

Use:
- `QA_SUBAGENT.md`

Goal:
- catch missing setup/config/docs before evaluator run
- verify claims vs what actually runs
- generate a self-check summary and fix gaps

---

## Step 4) Zip and upload

Use:
- `ZIP_AND_SUBMIT.md`

This is the final packaging checklist and zip guidance.

---

## Suggested prompts (Codex CLI) — run one step at a time

Run each step separately from project root.

### Prompt for Step 1 (initialize docs)

```bash
codex exec --full-auto "
Follow only SUBMISSION_TEMPLATE_INIT.md.
Initialize required submission files if missing:
README.md, PROBLEM.md, SOLUTION.md, RUNBOOK.md, .env.example.
Do not invent product claims. Keep placeholders where facts are unknown.
Print which files were created vs already existed.
"
```

### Prompt for Step 2 (fill real content)
*Disclaimer: This command can be skipped and you can update the md files yourself as well but please read and verify them*
```bash
codex exec --full-auto "
Follow INSTRUCTIONS.md Step 2 only.
Update PROBLEM.md, SOLUTION.md, and RUNBOOK.md with project-specific content.
Ensure SOLUTION.md uses explicit, testable claims.
Ensure RUNBOOK.md has exact clean-environment setup, run, and verification steps.
Print unresolved gaps as a checklist.
"
```

### Prompt for Step 3 (QA self-check)

```bash
codex exec --full-auto "
Follow QA_SUBAGENT.md only.
Read README.md, PROBLEM.md, SOLUTION.md, RUNBOOK.md and source code.
First summarize your understanding of the problem and solution.
Then run QA validation for setup/build/run and claims, run it in an isolated new env so that setup is also verified.
Create PROJECT_UNDERSTANDING.md, QA_SELF_CHECK.md, and QA_SELF_CHECK.json.
Mark each claim pass/fail/blocked/not_tested with evidence and fix hints.
"
```

### Prompt for Step 4 (zip and submit)

```bash
codex exec --full-auto "
Follow ZIP_AND_SUBMIT.md only.
Prepare final submission package.
Verify required docs are present and consistent with the code/runbook.
Create the zip using the naming convention.
Print final checklist, zip path, and unresolved blockers.
"
```
