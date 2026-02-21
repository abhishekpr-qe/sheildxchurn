# Runbook

## Estimated setup time

~10 minutes from clone to running app (without ML pipeline). ~30 minutes if running the full ML training pipeline.

## Prerequisites

- **Node.js 18+** — runtime for Express API and frontend
- **Python 3.12+** — runtime for ML pipeline and domain layer
- **npm** — Node.js package manager (bundled with Node.js)
- **pip** — Python package manager
- **PostgreSQL 14+** (optional) — for predictions persistence and cooldown tracking. Without it, these features operate in-memory only.
- **API keys** (optional) — see Environment Variables below. Without keys, the app runs in graceful degradation mode with rule-based scoring.

## Environment Variables

| Variable | Required? | Purpose | Sample Value | How to obtain |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | Claude AI for T6 risk analysis, briefs, chat | `sk-ant-api03-...` | Sign up at [console.anthropic.com](https://console.anthropic.com) |
| `GEMINI_API_KEY` | No | Gemini Flash for T5 risk enrichment | `AIza...` | Sign up at [aistudio.google.com](https://aistudio.google.com) |
| `ENABLE_GEMINI` | No | Kill switch for Gemini Flash (T5) | `true` | Set to `false` to disable |
| `OPENROUTER_KEY` | No | LLM gateway fallback for T5/T6 | `sk-or-...` | Sign up at [openrouter.ai](https://openrouter.ai) |
| `REDSHIFT_HOST` | No | Redshift cluster endpoint for live data | `cluster.region.redshift.amazonaws.com` | AWS Redshift console |
| `REDSHIFT_PORT` | No | Redshift port | `5439` | Default: 5439 |
| `REDSHIFT_USER` | No | Redshift username | `analyst` | AWS Redshift console |
| `REDSHIFT_PASSWORD` | No | Redshift password | `(secret)` | AWS Redshift console |
| `REDSHIFT_DB` | No | Redshift database name | `dev` | AWS Redshift console |
| `LOCAL_PG_HOST` | No | Local PostgreSQL for predictions + LLM costs | `localhost` | Local PostgreSQL install |
| `LOCAL_PG_PORT` | No | Local PostgreSQL port | `5439` | Default: 5439 |
| `LOCAL_PG_USER` | No | Local PostgreSQL username | `postgres` | Local PostgreSQL install |
| `LOCAL_PG_PASSWORD` | No | Local PostgreSQL password | `(secret)` | Local PostgreSQL install |
| `LOCAL_PG_DB` | No | Local PostgreSQL database | `churndb` | `createdb churndb` |
| `PG_HOST` | No | PostgreSQL for cooldown persistence | `localhost` | Local PostgreSQL install |
| `PG_PORT` | No | Cooldown PostgreSQL port | `5432` | Default: 5432 |
| `PG_USER` | No | Cooldown PostgreSQL username | `postgres` | Local PostgreSQL install |
| `PG_PASSWORD` | No | Cooldown PostgreSQL password | `(secret)` | Local PostgreSQL install |
| `PG_DATABASE` | No | Cooldown PostgreSQL database | `churndb` | `createdb churndb` |
| `MIXPANEL_API_SECRET` | No | Mixpanel API secret for funnel data | `(secret)` | Mixpanel project settings |
| `MIXPANEL_TOKEN` | No | Mixpanel token | `(token)` | Mixpanel project settings |
| `MIXPANEL_PROJECT_ID` | No | Mixpanel project ID | `12345678` | Mixpanel project settings |
| `MOENGAGE_APP_ID` | No | MoEngage app ID for push notifications | `(app_id)` | MoEngage dashboard |
| `MOENGAGE_API_KEY` | No | MoEngage push signature key | `(key)` | MoEngage dashboard |
| `MOENGAGE_DATA_API_KEY` | No | MoEngage data API Basic Auth key | `(key)` | MoEngage dashboard |
| `MOENGAGE_API_URL` | No | MoEngage API base URL | `https://api-01.moengage.com` | Default works for most regions |
| `RETELL_API_KEY` | No | Retell.ai API key for voice calls | `key_...` | [retellai.com](https://retellai.com) |
| `RETELL_AGENT_ID` | No | Retell.ai agent ID | `agent_...` | Retell.ai dashboard |
| `AWS_ACCESS_KEY_ID` | No | AWS access key for S3 audit trail | `AKIA...` | AWS IAM console |
| `AWS_SECRET_ACCESS_KEY` | No | AWS secret key | `(secret)` | AWS IAM console |
| `S3_BUCKET` | No | S3 bucket name for audit trail | `my-bucket` | AWS S3 console |
| `AWS_REGION` | No | AWS region | `ap-south-1` | AWS console |
| `PORT` | No | Backend server port | `3001` | Default: 3001 |
| `PORT_FE` | No | Frontend server port | `3000` | Default: 3000 |
| `GITHUB_TOKEN` | No | GitHub token for rule evolution PRs | `ghp_...` | GitHub settings > Developer settings |

> **Note:** All environment variables are optional. Without any keys, the app starts successfully and operates in graceful degradation mode (rule-based scoring, mock integrations, in-memory storage).

## Setup

```bash
# 1. Clone the repository
git clone <repo-url> && cd sheildxchurn

# 2. Install Node.js dependencies
npm install

# 3. Install Python dependencies
pip install -e ".[dev]"

# 4. Configure environment variables
cp .env.example .env
# Edit .env with your API keys (all optional — app works without them)

# 5. (Optional) Seed data — if you have a transactions CSV
python scripts/process_transactions.py
```

## Run

### Start backend (required)

```bash
node server/index.js
```

**Expected output:**
```
[INFO] Loaded X users from dashboard data
[INFO] Server listening on port 3001
[INFO] Swagger UI available at http://localhost:3001/api-docs
```

### Start frontend (required for dashboard)

```bash
node server/frontend.js
```

**Expected output:**
```
Frontend serving public/ on port 3000
```

### Verify both are running

```bash
# Backend health check
curl http://localhost:3001/healthz
# Expected: { "status": "ok", "uptime": <seconds> }

# Frontend dashboard
open http://localhost:3000
# Expected: 10-tab dark-themed dashboard loads
```

## Verification Steps (mapped 1:1 to SOLUTION.md claims)

Each step below corresponds to a claimed feature. Evaluators should run these in order.

### Claim 1: Dashboard loads with 10 functional tabs

1. Open `http://localhost:3000` in a browser
2. Verify the dark-themed dashboard loads
3. Count the tabs in the navigation: Warroom, Explorer, Dossier, Playbooks, Model, Live, Campaigns, Simulator, Sentiment, Config
4. **Expected:** 10 tabs visible and clickable. Each tab renders its content area (data depends on Redshift/data files).

### Claim 2: API serves 52+ endpoints with Swagger UI

1. Open `http://localhost:3001/api-docs` in a browser
2. **Expected:** Swagger UI loads with OpenAPI 3.0.3 spec showing 52+ endpoints grouped by category (Data, Live, AI, Campaigns, Predictions, etc.)
3. Expand any endpoint group to see individual endpoints with request/response schemas

### Claim 3: Healthcheck returns OK

1. Run: `curl http://localhost:3001/healthz`
2. **Expected:** `{ "status": "ok", "uptime": <number> }`

### Claim 4: ML ensemble model with AUC 0.941

1. Run: `curl http://localhost:3001/api/model`
2. **Expected:** Response includes `model_type: "ensemble"`, `metrics.test_auc: 0.941`, `base_models: ["LightGBM", "XGBoost", "CatBoost"]`, `meta_learner: "LogisticRegression"`
3. Run: `curl http://localhost:3001/api/model/health`
4. **Expected:** Response includes backtest results and model health status

### Claim 5: Rule engine evaluates 25 YAML-driven rules at $0

1. Run:
   ```bash
   curl -X POST http://localhost:3001/api/ai/risk-analysis \
     -H "Content-Type: application/json" \
     -d '{"userIds": ["test-user-1"]}'
   ```
2. **Expected:** Response includes `source: "rule_engine"`, `tier: "T2"`, `cost: 0`, and `risk_signals` array derived from `rules.yaml`
3. Verify `server/rules.yaml` contains 25 rules by running: `grep -c "^  - name:" server/rules.yaml`

### Claim 6: Tiered LLM scoring with auto-routing and OpenRouter fallback

1. **Without API keys** — verify T2 fallback:
   ```bash
   curl -X POST http://localhost:3001/api/ai/risk-analysis \
     -H "Content-Type: application/json" \
     -d '{"userIds": ["test-user-1"]}'
   ```
   **Expected:** `source: "rule_engine"`, `tier: "T2"` (graceful degradation)

2. **With `ANTHROPIC_API_KEY` set** — verify T6 for edge cases:
   Requires a user with churn score between 0.38-0.42 in the data.
   **Expected:** Response shows `tier: "T6"`, `source` includes "haiku"

3. **With `GEMINI_API_KEY` set** — verify T5 for CRITICAL/HIGH:
   Requires a CRITICAL or HIGH risk user in the data.
   **Expected:** Response shows `tier: "T5"`, `source` includes "gemini"

### Claim 7: AI-powered retention briefs with fallback

1. Run:
   ```bash
   curl -X POST http://localhost:3001/api/ai/brief \
     -H "Content-Type: application/json" \
     -d '{"userId": "test-user-1"}'
   ```
2. **With `ANTHROPIC_API_KEY`:** Response contains a 3-4 sentence AI-generated brief about the user's risk profile
3. **Without `ANTHROPIC_API_KEY`:** Response contains a rule-based brief (templated fallback)

### Claim 8: Conversational churn intelligence

1. Run:
   ```bash
   curl -X POST http://localhost:3001/api/ai/chat \
     -H "Content-Type: application/json" \
     -d '{"message": "Which corridor has the highest churn rate?"}'
   ```
2. **Expected:** AI-generated response about churn patterns with platform context. Without API key, returns rule-based response.

### Claim 9: MoEngage push with cooldown and rollback

1. Run:
   ```bash
   curl -X POST http://localhost:3001/api/moengage/engage \
     -H "Content-Type: application/json" \
     -d '{"userId": "test-user-1", "channel": "push"}'
   ```
2. **Expected:** Response includes intervention details, cooldown set for 7 days
3. Repeat the same request immediately:
   **Expected:** HTTP 409 with cooldown active message (7-day window enforced)
4. Check cooldown status: `curl http://localhost:3001/api/cooldown/test-user-1`
   **Expected:** Shows active cooldown with `cooldown_until` timestamp

### Claim 10: Retell.ai voice calls with agent context

1. Run:
   ```bash
   curl -X POST http://localhost:3001/api/retell/call \
     -H "Content-Type: application/json" \
     -d '{"user_id": "test-user-1", "phone": "+1-234-567-8900"}'
   ```
2. **Without `RETELL_API_KEY`:** Response includes `mock: true` and `agent_context` with risk_tier, churn_probability, corridor, intervention_type, intervention_message
3. **With `RETELL_API_KEY`:** Initiates real voice call via Retell.ai API

### Claim 11: S3 audit trail for interventions

1. Trigger an intervention:
   ```bash
   curl -X POST http://localhost:3001/api/interventions/trigger \
     -H "Content-Type: application/json" \
     -d '{"userId": "test-user-1", "channel": "manual"}'
   ```
2. **Without S3 keys:** Response includes `s3: { mock: true, key: "campaigns/YYYY-MM-DD/uuid.json" }` — shows the key pattern
3. **With S3 keys:** JSON is written to S3 bucket at `campaigns/{date}/{uuid}.json`
4. Check intervention log: `curl http://localhost:3001/api/interventions/log`
   **Expected:** Shows the intervention entry with timestamp, tier, channel, and user details

### Claim 12: Self-learning feedback loop with 60-day evaluation

1. **Requires local PostgreSQL.** Write predictions:
   ```bash
   curl -X POST http://localhost:3001/api/predictions/write \
     -H "Content-Type: application/json" \
     -d '{"predictions": [{"user_id": "test-1", "score": 0.85, "risk_tier": "CRITICAL", "model_version": "v1", "top_reasons": ["inactivity"]}]}'
   ```
   **Expected:** `{ "written": 1 }`
2. Evaluate outcomes (requires Redshift for actual transaction lookup):
   ```bash
   curl -X POST http://localhost:3001/api/predictions/evaluate
   ```
   **Expected:** Response shows evaluation results with actual_outcome per user
3. **Without PostgreSQL:** Write endpoint returns `{ "written": 0, "error": "PostgreSQL not configured" }`

### Claim 13: Model drift detection

1. Run: `curl http://localhost:3001/api/predictions/drift`
2. **Expected:** Response includes `baseline_auc`, `current_status`, governance thresholds (`drop_threshold_pct: 5`, `consecutive_runs_required: 2`), and feature drift z-scores if `retrain_report.json` exists

### Claim 14: LLM cost tracking per tier

1. Run: `curl http://localhost:3001/api/predictions/cost`
2. **Expected:** Response includes per-tier breakdown (T2, T5, T6) with `calls`, `input_tokens`, `output_tokens`, `cost_usd`
3. After making AI requests with API keys, cost counters should reflect usage
4. **Without any LLM calls:** Returns zeroed counters (expected — T2 is $0)

### Claim 15: 136 tests pass

1. Run all tests:
   ```bash
   make check
   ```
   **Expected:** 66 Python tests + 70 Node.js tests = 136 total, all passing
2. Or run individually:
   ```bash
   # Python tests (66)
   pytest tests/ -v

   # Node.js tests (70)
   npx jest --verbose
   ```

## Sample Inputs/Outputs

| Input | Where to use it | Expected Output |
|---|---|---|
| `curl http://localhost:3001/healthz` | Terminal | `{ "status": "ok", "uptime": 5.123 }` |
| `curl http://localhost:3001/api/model` | Terminal | JSON with `model_type: "ensemble"`, `metrics.test_auc: 0.941` |
| `curl -X POST .../api/ai/risk-analysis -d '{"userIds":["u1"]}'` | Terminal | JSON with `risk_signals`, `intervention_plan`, `source`, `tier`, `cost` |
| `curl -X POST .../api/ai/brief -d '{"userId":"u1"}'` | Terminal | `{ "brief": "3-4 sentence retention summary..." }` |
| `open http://localhost:3000` | Browser | 10-tab dark-themed dashboard |
| `open http://localhost:3001/api-docs` | Browser | Swagger UI with 52+ endpoints |
| `make check` | Terminal | `136 tests passed` |

## Known Issues / Workarounds

- **Empty dashboard without data files:** If `data/churn_dashboard_data.json` and `data/real_transactions.json` are not present (gitignored), the dashboard loads with default/empty values. **Workaround:** Run `python scripts/process_transactions.py` with a seed CSV, or connect Redshift for live data.
- **Port 3000 vs 3001:** The backend API runs on port 3001. The frontend dashboard runs on port 3000. Use `http://localhost:3000` for the dashboard, `http://localhost:3001` for direct API calls and Swagger UI.
- **MoEngage/Retell mock mode:** Without valid API keys, engagement endpoints return mock responses (`{ mock: true }`). This is by design — core scoring and dashboard features work without external service credentials.
- **PostgreSQL not available:** Predictions, LLM cost tracking, and cooldown persistence require PostgreSQL. Without it, these features operate in-memory (lost on restart). All other features work normally.
- **Redshift not available:** Live data tabs (Early Warnings, Corridor Health, Monthly Trends) show cached/default values. The dashboard, AI scoring, and rule engine remain fully functional.

## Shutdown/Cleanup

```bash
# Stop both servers (Ctrl+C in each terminal)
# Or if running in background:
kill $(lsof -t -i:3001)  # Stop backend
kill $(lsof -t -i:3000)  # Stop frontend

# (Optional) Clean up data artifacts
rm -rf data/*.json data/*.csv data/*.pkl

# (Optional) Clean up node modules and Python venv
rm -rf node_modules/
rm -rf .venv/
```
