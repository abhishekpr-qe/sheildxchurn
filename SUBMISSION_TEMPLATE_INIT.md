# SUBMISSION_TEMPLATE_INIT.md

## Purpose

Initialize your submission with required files and starter templates.

> ⚠️ Disclaimer (Important)
> - This is a template only.
> - You must replace placeholder content with your actual project details.
> - `PROBLEM.md` and `SOLUTION.md` must reflect your real context.
> - Claims in `SOLUTION.md` will be verified by evaluator.
> - `RUNBOOK.md` quality directly impacts whether your solution can be validated.

---

## Required files to create

- `README.md`
- `PROBLEM.md`
- `SOLUTION.md`
- `RUNBOOK.md`
- `.env.example`

---

## Starter templates

### README.md

```md
# <Project Name>

## Summary
<2-4 lines: what you built, what problem it solves, and the key AI capability>

## Team
- **Team Name:** <name>
- **Members:** <name (role)>, <name (role)>

## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | <e.g., React, Next.js> |
| Backend | <e.g., FastAPI, Spring Boot> |
| AI/ML | <e.g., Claude Sonnet, OpenAI GPT-4, LangChain> |
| Data/Infra | <e.g., PostgreSQL, Redis, Docker> |

## Quick Start
See `RUNBOOK.md` for full setup. Estimated time: <X minutes>.
```

### PROBLEM.md

```md
# Problem Statement

## Context
<What Aspora/user problem are you solving? 2-3 sentences.>

## Target Users
<Who benefits? Name the specific role or persona, not "everyone.">

## Pain Points
| Pain Point | Who feels it | Current workaround | Estimated impact |
|---|---|---|---|
| <Pain 1> | <role> | <what they do today> | <time lost / error rate / cost> |
| <Pain 2> | <role> | <what they do today> | <time lost / error rate / cost> |

## Success Criteria
- <Measurable outcome 1 — e.g., "Reduces triage time from 30 min to under 5 min">
- <Measurable outcome 2 — e.g., "Eliminates manual copy-paste across 3 systems">

## Why Now
<What changed that makes this problem worth solving today? New data source, new pain threshold, new tooling available?>
```

### SOLUTION.md

```md
# Solution

## Approach
<High-level architecture in 3-5 sentences. What are the major components and how do they connect?>

## Architecture Diagram (optional but recommended)
<ASCII diagram, Mermaid block, or reference to an image file in /docs>

## AI Usage (mandatory — this is 25% of your score)

| AI Tool / Model | Where in the app | What it does | Why AI over a non-AI approach |
|---|---|---|---|
| <e.g., Claude Sonnet> | <e.g., /api/triage endpoint> | <e.g., classifies incoming tickets by urgency> | <e.g., rules-based approach can't handle free-text descriptions> |
| <e.g., Embeddings API> | <e.g., search module> | <e.g., semantic search over knowledge base> | <e.g., keyword search misses synonyms and context> |

## Features Claimed (Evaluator checks these)

Each claim must be specific and testable. Vague claims like "uses AI" will score poorly.

- [ ] <Specific claim 1 — e.g., "User can upload a CSV and get anomaly detection results in under 10 seconds">
- [ ] <Specific claim 2 — e.g., "System correctly triages 3 of 5 sample tickets to the right severity level">
- [ ] <Specific claim 3 — e.g., "Dashboard auto-refreshes with new data every 30 seconds">

## What we would build next (out of scope for this submission)
- <Feature you scoped out and why>

## Assumptions
- <Assumption 1 — e.g., "Evaluator has an OpenAI API key with GPT-4 access">

## Limitations / Trade-offs
- <Limitation 1 — e.g., "Only tested with English-language inputs">
- <Trade-off 1 — e.g., "Chose speed over accuracy: model responses are not cached">
```

### RUNBOOK.md

```md
# Runbook

## Estimated setup time
<e.g., "5 minutes from clone to running app">

## Prerequisites
- <Runtime + exact version — e.g., "Node.js 20.x", "Python 3.11+", "Docker 24+">
- <Any external services — e.g., "OpenAI API key with GPT-4 access">

## Environment Variables
| Variable | Required? | Purpose | Sample Value | How to obtain |
|---|---|---|---|---|
| <NAME> | Yes/No | <purpose> | <non-secret sample> | <e.g., "Sign up at platform.openai.com"> |

## Setup
1. <install step — exact command>
2. <build step — exact command>
3. <seed/migrate step if applicable>

## Run
1. <start backend — exact command + expected output, e.g., "Server listening on :8080">
2. <start frontend/worker — exact command + expected output>

## Verification Steps (mapped 1:1 to SOLUTION.md claims)

Each step below corresponds to a claimed feature. Evaluators will run these in order.

### Claim 1: <paste exact claim text from SOLUTION.md>
1. <Step-by-step action — e.g., "Open http://localhost:3000/upload">
2. <What to input — e.g., "Upload the sample file at /test-data/sample.csv">
3. <Expected result — e.g., "Table shows 3 anomalies highlighted in red within 10 seconds">

### Claim 2: <paste exact claim text from SOLUTION.md>
1. <step>
2. <expected result>

## Sample Inputs/Outputs
| Input | Where to use it | Expected Output |
|---|---|---|
| <e.g., test-data/sample.csv> | <e.g., Upload page> | <e.g., 3 anomalies detected, severity: high/medium/low> |

## Known Issues / Workarounds
- <issue — be specific about when it happens and how to work around it>

## Shutdown/Cleanup
- <exact commands to stop services and clean up>
```

### .env.example

```bash
# Template only. Do NOT put real secrets.
APP_ENV=development
API_BASE_URL=http://localhost:3000
# ... add all required env vars used by your app
```

---

## Sample prompt (Codex CLI) — template initialization

```bash
codex exec --full-auto "
Initialize submission docs in this repo using SUBMISSION_TEMPLATE_INIT.md.
Create missing required files with starter templates.
Do not invent fake production secrets.
At the end, print what was created/updated.
"
```
