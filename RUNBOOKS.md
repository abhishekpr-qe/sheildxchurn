# RUNBOOKS.md — ShieldXChurn Operations Guide

---

## 1. Architecture Overview

```
┌──────────┐     ┌──────────────────┐     ┌──────────────────────────────────┐
│  Browser  │────▶│  Frontend (:3000) │────▶│        Backend (:3001)           │
└──────────┘     │  server/frontend.js│     │        server/index.js           │
                 └──────────────────┘     │                                  │
                                           │  ┌────────────┐ ┌────────────┐  │
                                           │  │  Redshift   │ │  MoEngage  │  │
                                           │  │  (pg pool)  │ │  Push/Data │  │
                                           │  └────────────┘ └────────────┘  │
                                           │  ┌────────────┐ ┌────────────┐  │
                                           │  │  Mixpanel   │ │  Anthropic │  │
                                           │  │  Funnels    │ │  Claude AI │  │
                                           │  └────────────┘ └────────────┘  │
                                           │  ┌────────────┐ ┌────────────┐  │
                                           │  │  Retell.ai  │ │  AWS S3    │  │
                                           │  │  Voice Call  │ │  Audit Log │  │
                                           │  └────────────┘ └────────────┘  │
                                           │  ┌────────────┐                 │
                                           │  │ PostgreSQL  │                 │
                                           │  │ (cooldowns) │                 │
                                           │  └────────────┘                 │
                                           └──────────────────────────────────┘

┌──────────────── Python ML Pipeline (offline) ────────────────┐
│  Extract (Mixpanel) → Train (Ensemble) → Score → Dashboard   │
│  scripts/extract_signals.py → train_model.py → JSON output   │
└──────────────────────────────────────────────────────────────┘
```

**Data flow:** Extract signals from Mixpanel/Redshift (Python) → Train ensemble model → Score users → Serve via API → Engage via MoEngage/Retell/AI

**Tech stack:**
- Backend: Node.js (Express 5), CommonJS
- Frontend: Vanilla HTML/JS served via Express
- ML: Python 3 (LightGBM, XGBoost, CatBoost, scikit-learn)
- Databases: Amazon Redshift (analytics), PostgreSQL (cooldowns)
- External: MoEngage, Mixpanel, Anthropic Claude, Retell.ai, AWS S3

---

## 2. Environment Setup

All env vars are read in `server/config.js` via `dotenv`. Create a `.env` file in the project root.

### Required

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Claude AI risk analysis + chat | — (falls back to rule-based) |
| `REDSHIFT_HOST` | Redshift cluster endpoint | — (live queries disabled) |
| `REDSHIFT_PORT` | Redshift port | `5439` |
| `REDSHIFT_USER` | Redshift username | — |
| `REDSHIFT_PASSWORD` | Redshift password | — |
| `REDSHIFT_DB` | Redshift database | `dev` |

### Optional — MoEngage

| Variable | Purpose | Default |
|----------|---------|---------|
| `MOENGAGE_APP_ID` | MoEngage application ID | Hardcoded fallback |
| `MOENGAGE_API_KEY` | Push signature key | Hardcoded fallback |
| `MOENGAGE_DATA_API_KEY` | Data API Basic Auth key | Hardcoded fallback |
| `MOENGAGE_API_URL` | MoEngage API base URL | `https://api-01.moengage.com` |
| `MOENGAGE_PUSH_URL` | Push API URL override | Falls back to `MOENGAGE_API_URL` |

### Optional — PostgreSQL (Cooldowns)

| Variable | Purpose | Default |
|----------|---------|---------|
| `PG_HOST` | PostgreSQL host for cooldowns | — (in-memory only) |
| `PG_PORT` | PostgreSQL port | `5432` |
| `PG_USER` | PostgreSQL username | — |
| `PG_PASSWORD` | PostgreSQL password | — |
| `PG_DATABASE` | PostgreSQL database name | — |

### Optional — Mixpanel

| Variable | Purpose | Default |
|----------|---------|---------|
| `MIXPANEL_API_SECRET` | Mixpanel API secret (Basic Auth) | — (Mixpanel disabled) |
| `MIXPANEL_TOKEN` | Mixpanel token | — |
| `MIXPANEL_PROJECT_ID` | Mixpanel project ID | — |

### Optional — AWS S3

| Variable | Purpose | Default |
|----------|---------|---------|
| `AWS_ACCESS_KEY_ID` | AWS access key | — (S3 writes return `{ mock: true }`) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | — |
| `S3_BUCKET` | S3 bucket for audit trail | — |
| `AWS_REGION` | AWS region | — |

### Optional — Retell.ai

| Variable | Purpose | Default |
|----------|---------|---------|
| `RETELL_API_KEY` | Retell.ai API key | — (mock mode) |
| `RETELL_AGENT_ID` | Retell.ai agent ID | — |

### Optional — Frontend

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Backend port | `3001` |
| `PORT_FE` | Frontend port | `3000` |
| `BACKEND_URL` | Backend URL for frontend | `''` (same-origin) |

---

## 3. Backend Runbook

**Entry point:** `server/index.js` (port 3001)

### Start / Stop

```bash
# Start backend
npm start          # or: node server/index.js

# Start with custom port
PORT=4001 node server/index.js
```

### Startup Sequence

1. **Load cache** — reads `data/churn_dashboard_data.json` + optional `data/real_transactions.json`, builds user index (`server/services/cache.js`)
2. **Create Express app** — CORS, JSON parsing, rate limiters, request tracing
3. **Register routes** — data, live, cohorts, dossier, campaigns, ai
4. **Mount healthcheck** — `GET /healthz`
5. **Mount Swagger UI** — `GET /api-docs` (from `server/openapi.yaml`)
6. **Listen on PORT** — logs user count, model type, integration status
7. **Init cooldown table** — creates `sc_cooldowns` table if PG configured, loads active cooldowns into memory
8. **Redshift refresh** — 5s delay, then `refreshAllData()`, repeats every 6 hours
9. **Mixpanel refresh** — 8s delay, then `refreshMixpanelData()`, repeats every 6 hours

### Rate Limits

| Scope | Limit |
|-------|-------|
| `POST /api/*` (general) | 100 requests / 60s per IP |
| `POST /api/metabase/query` | 10 requests / 60s per IP |

### Health Check

```bash
curl http://localhost:3001/healthz
# → { "status": "ok", "uptime": 123.456 }
```

---

## 4. Frontend Runbook

**Entry point:** `server/frontend.js` (port 3000)

### Start

```bash
npm run start:fe   # or: node server/frontend.js
```

### API_BASE Resolution

The frontend injects `window.API_BASE` at request time:

1. **Cloudflare Tunnel** — if hostname contains `-fe.`, swaps to `-be.` (e.g., `app-fe.example.com` → `https://app-be.example.com`)
2. **Local dev** — uses `BACKEND_URL` env var
3. **Same-origin fallback** — empty string (proxied or co-located)

### Static Files

Served from `public/` with caching disabled (`etag: false`, `maxAge: 0`).

---

## 5. MoEngage Push Notification Runbook

**Source:** `server/services/moengage.js`, `server/routes/campaigns.js`

### Authentication

| API | Auth Method |
|-----|-------------|
| Data API (sync/events) | Basic Auth: `base64(MOENGAGE_APP_ID:MOENGAGE_DATA_API_KEY)` |
| Push API | Signature-in-body: `SHA256(MOENGAGE_APP_ID\|campaignName\|MOENGAGE_API_KEY)` |

### Single User Flow

`POST /api/moengage/engage` → with cooldown check:

1. **Acquire per-user lock** (spin-wait: 50 attempts × 100ms)
2. **Check cooldown** → 409 if active
3. **Write cooldown to DB** (before MoEngage calls — crash-safe)
4. `syncUserAttributes(userId, { risk_tier, churn_probability, corridor, ... })`
5. `trackEvent(userId, 'churn_intervention_triggered', { channel, tier, ... })`
6. `sendMoEngagePush({ userIds: [userId], message, title, ... })` (if channel includes push)
7. **Log intervention** + **S3 audit trail**
8. On MoEngage failure → **rollback cooldown**

### Bulk Flow

`POST /api/moengage/bulk`:

1. Select target users by tier, filter out cooldown-active users
2. Bounded-parallel sync (concurrency limit: 10): `syncUserAttributes` for each user
3. `trackEvent('system', 'bulk_churn_campaign_triggered', ...)`
4. `sendMoEngagePush` with `comparisonParameter: 'in'` (batch up to 50 user IDs)
5. Set cooldowns after successful sync
6. S3 audit trail

### Push Payload Spec

```json
{
  "appId": "MOENGAGE_APP_ID",
  "signature": "sha256(appId|campaignName|apiKey)",
  "campaignName": "churn_CRITICAL_1234567890",
  "targetPlatform": ["ANDROID", "IOS"],
  "targetAudience": "User",
  "targetUserAttributes": {
    "attribute": "USER_ATTRIBUTE_UNIQUE_ID",
    "comparisonParameter": "is | in",
    "attributeValue": "userId | [userId1, userId2, ...]"
  },
  "payload": {
    "ANDROID": { "title": "Vance", "message": "...", "defaultAction": { "type": "deeplinking", "value": "..." } },
    "IOS": { "title": "Vance", "message": "...", "defaultAction": { "type": "deeplinking", "value": "..." } }
  },
  "campaignDelivery": { "type": "soon" },
  "advancedSettings": {
    "ttl": { "ANDROID": 672 },
    "ignoreFC": "true",
    "sendAtHighPriority": "true"
  }
}
```

### URLs

| API | URL |
|-----|-----|
| Data API (sync/events) | `{MOENGAGE_API_URL}/v1/customer/{appId}`, `{MOENGAGE_API_URL}/v1/event/{appId}` |
| Push API | `{MOENGAGE_PUSH_URL \|\| MOENGAGE_API_URL}/v2/transaction/sendpush` |

### Retry Policy

- **Retries:** 2 (total 3 attempts)
- **Backoff:** exponential — `2^attempt × 500ms` (500ms, 1000ms)
- **Timeout:** 15s per request (`AbortSignal.timeout(15000)`)
- **Retry triggers:** HTTP 429, HTTP 5xx, `TimeoutError`, `AbortError`

---

## 6. Redshift Runbook

**Source:** `server/services/redshift.js`

### Pool Config

| Setting | Value |
|---------|-------|
| Port | `REDSHIFT_PORT` or `5439` |
| Database | `REDSHIFT_DB` or `dev` |
| Max connections | 5 |
| SSL | enabled (`rejectUnauthorized: false`) |
| Connection timeout | 15s |
| Idle timeout | 60s |

### Refresh Cycle

- **Interval:** every 6 hours (`REFRESH_INTERVAL = 6 * 60 * 60 * 1000`)
- **Initial delay:** 5s after server start
- **Trigger:** automatic on startup, or manual via `POST /api/refresh`

### Queries

Executed sequentially during each refresh:

| Query Key | Purpose | On Failure |
|-----------|---------|------------|
| `monthly_trends` | 12-month rolling transaction trends | Error logged |
| `corridor_health` | Per-corridor user/volume/delivery stats | Error logged |
| `partner_performance` | Fulfillment partner failure/speed | Error logged |
| `new_user_cohorts` | New user cohort retention tracking | Error logged |
| `prediction_validation` | ML prediction vs actual comparison | **Skipped silently** |
| `early_warnings` | Real-time churn risk signals | Error logged |
| `decagon_conversations` | Support conversation data | Error logged |
| `delivery` | Delivery performance metrics | Error logged |

Queries marked "skipped silently" (`prediction_validation`, `pricing`) log a warning but don't report as errors.

### Direct Query Proxy

`POST /api/metabase/query` supports:

- **Named queries:** `{ "query_key": "monthly_trends" }` — executes predefined SQL
- **Direct SQL:** `{ "sql": "SELECT ..." }` — SELECT-only allowlist; blocks `DROP`, `DELETE`, `INSERT`, `UPDATE`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`

---

## 7. Cooldown System Runbook

**Source:** `server/services/cooldown.js`

### PostgreSQL Table

```sql
CREATE TABLE IF NOT EXISTS sc_cooldowns (
  user_id           VARCHAR(64) PRIMARY KEY,
  action_type       VARCHAR(30) NOT NULL,
  channel           VARCHAR(30),
  sent_at           TIMESTAMPTZ NOT NULL,
  cooldown_until    TIMESTAMPTZ NOT NULL,
  cohort            VARCHAR(50),
  cost              FLOAT DEFAULT 0,
  campaign_id       VARCHAR(64),
  source            VARCHAR(50),
  corridor          VARCHAR(30),
  risk_tier         VARCHAR(20),
  churn_probability FLOAT
);
CREATE INDEX IF NOT EXISTS idx_sc_cooldowns_until ON sc_cooldowns(cooldown_until);
```

### Behavior

- **Window:** 7 days (`COOLDOWN_HOURS = 168`)
- **In-memory cache:** `Map` loaded from DB on startup
- **DB writes:** UPSERT on `user_id` (atomic, race-safe)
- **Restart required** after manual DB edits (in-memory cache won't reflect changes until reload)

### Per-User Lock

Spin-wait for serialization of concurrent engage requests on the same user:
- Max attempts: 50
- Wait per attempt: 100ms
- Throws `Lock timeout for {userId}` after 5s

### Hourly Cleanup

Runs every hour when PG is configured:
1. `DELETE FROM sc_cooldowns WHERE cooldown_until <= NOW()`
2. Sweep in-memory `Map` for expired entries
3. Logs count of removed rows

### Rollback on MoEngage Failure

If MoEngage calls fail after cooldown was written, the cooldown is **removed** from both DB and memory (Fix #6 — crash window protection).

---

## 8. S3 Audit Trail Runbook

**Source:** `server/services/campaign.js`

### Config

- Enabled when both `AWS_ACCESS_KEY_ID` and `S3_BUCKET` are set
- Region from `AWS_REGION`

### Key Pattern

```
campaigns/{YYYY-MM-DD}/{uuid}.json
```

Example: `campaigns/2026-02-21/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json`

### Payload Structure

```json
{
  "campaign_id": "uuid",
  "triggered_at": "ISO8601",
  "triggered_by": "dashboard",
  "tier": "CRITICAL",
  "channel_used": "MoEngage | Retell.ai | push",
  "llm_analysis_included": true,
  "total_targeted": 1,
  "users": [
    {
      "user_id": "...",
      "corridor": "UAE → India",
      "risk_tier": "CRITICAL",
      "churn_probability": 0.92,
      "communication_type": "push",
      "tool_used": "moengage | retell_ai | manual",
      "sent_at": "ISO8601",
      "intervention_type": "support_callback",
      "intervention_message": "...",
      "llm_risk_signals": [...],
      "llm_justification": "...",
      "status": "sent",
      "moengage_response": {...}
    }
  ]
}
```

### Graceful Degradation

When S3 is not configured (`AWS_ACCESS_KEY_ID` or `S3_BUCKET` missing):
- `writeToS3()` returns `{ mock: true, key: "..." }`
- No error thrown — campaign proceeds normally

---

## 9. Mixpanel Runbook

**Source:** `server/services/mixpanel.js`, `server/routes/ai.js`

### Authentication

Basic Auth: `base64(MIXPANEL_API_SECRET:)` (note trailing colon, empty password)

### APIs Used

| API | URL | Purpose |
|-----|-----|---------|
| Funnel API | `https://mixpanel.com/api/2.0/funnels` | Conversion funnel data |
| Engage API | `https://mixpanel.com/api/2.0/engage` | User profile stats |

### Configured Funnels

| Key | Funnel ID | Name |
|-----|-----------|------|
| `onboarding` | 87507718 | Onboarding Funnel |
| `activation` | 85141774 | Onboarding + Activation |
| `uae_onboarding` | 86423593 | UAE Onboarding |
| `uk_onboarding` | 86423594 | UK Onboarding |
| `us_onboarding` | 86423597 | US Onboarding |

### Refresh Cycle

- **Interval:** every 6 hours
- **Initial delay:** 8s after server start
- **Process:** fetches all 5 funnels in parallel, then engage stats
- **Date range:** current month start → today

### Rate Limit Handling

On non-`2xx` response: logs warning with first 80 chars of error message, continues to next funnel. No retry.

---

## 10. Retell.ai Voice Call Runbook

**Source:** `server/routes/campaigns.js`

### Endpoint

`POST /api/retell/call`

```json
{
  "user_id": "...",
  "phone": "+1-234-567-8900"
}
```

### Retell API

- **URL:** `https://api.retellai.com/v2/create-phone-call`
- **Auth:** `Bearer {RETELL_API_KEY}`

### Agent Prompt Params

Passed to the Retell agent for context:

| Param | Source |
|-------|--------|
| `user_name` | user_id |
| `corridor` | user.corridor |
| `risk_tier` | user.risk_tier |
| `churn_probability` | Formatted as percentage string |
| `primary_reason` | First reason description or 'inactivity' |
| `intervention_type` | Resolved intervention type |
| `intervention_message` | Resolved intervention message |
| `tenure_days` | String |
| `total_txns` | String |

### Mock Mode

When `RETELL_API_KEY` or `RETELL_AGENT_ID` is not set:
- Returns `{ mock: true, message: "[DEMO] Would call ..." }`
- Includes `agent_context` with risk data for testing

---

## 11. AI Risk Analysis Runbook

**Source:** `server/services/ai.js`, `server/routes/ai.js`

### Model

`claude-haiku-4-5-20251001` via Anthropic Messages API (`https://api.anthropic.com/v1/messages`)

### Endpoints

| Method | Path | Purpose | Max Tokens |
|--------|------|---------|------------|
| POST | `/api/ai/risk-analysis` | Structured risk signals + intervention plan | 800 |
| POST | `/api/ai/brief` | 3-4 sentence user brief | 500 |
| POST | `/api/ai/chat` | Conversational churn intelligence | 800 |

### Risk Analysis Cache

- **TTL:** 5 minutes (`RISK_CACHE_TTL = 5 * 60 * 1000`)
- **Key:** user_id
- **Batch limit:** max 20 users per request

### Fallback Chain

1. **LLM available** → call Anthropic, parse JSON response
2. **JSON parse failure** → `rule_based_parse_fallback` (confidence: 0.6)
3. **LLM error/timeout** → `rule_based_fallback` (confidence: 0.65)
4. **No API key** → `rule_based` (confidence: 0.7)

All fallbacks use `buildFallback()` which generates risk signals from user reasons, a 3-step intervention plan, and justification from ML scores.

---

## 12. Python ML Pipeline Runbook

### Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/extract_signals.py` | Extract 43 features from Mixpanel | `python3 scripts/extract_signals.py --from-date 2025-06-01 --to-date 2026-02-20 --output data/signals.csv` |
| `scripts/train_model.py` | Train ensemble model | `python3 scripts/train_model.py --input data/signals.csv --output data/` |
| `scripts/process_transactions.py` | Process raw transaction CSV into dashboard JSON | `python3 scripts/process_transactions.py` |
| `scripts/retrain.py` | Weekly retrain with drift detection | `python3 scripts/retrain.py --model data/churn_model_ensemble.pkl --data data/signals.csv` |

### Ensemble Architecture

- **Base models:** LightGBM + XGBoost + CatBoost
- **Meta-learner:** LogisticRegression (stacking)
- **Split:** 70% train, 15% validation, 15% test (stratified)

### Signal Features (43 total)

| Category | Count | Examples |
|----------|-------|---------|
| User properties | 9 | `days_since_last_seen`, `push_enabled`, `is_referred`, `kyc_verified` |
| Engagement signals | 7 | `app_opens_l30`, `session_freq_ratio`, `unique_screens_visited` |
| Transaction signals | 9 | `order_created_l30`, `order_completed_l30`, `tx_frequency_ratio` |
| Transfer funnel | 3 | `started_never_completed`, `transfer_intent_l30`, `funnel_reach_l30` |
| Friction signals | 4 | `api_errors_l30`, `api_timeouts_l30`, `error_rate`, `help_opens_l30` |
| Screen journey | 3 | `onboarding_step_reached`, `kyc_completed`, `onboarding_completed` |
| Timing signals | 4 | `days_since_first_event`, `days_to_first_order`, `tx_regularity_score` |
| Feature interactions | 4 | `is_one_and_done`, `kyc_completed_no_order`, `errors_before_first_order`, `high_intent_no_completion` |

### Risk Tiers

| Tier | Churn Probability Threshold |
|------|----------------------------|
| CRITICAL | ≥ 0.8 |
| HIGH | ≥ 0.6 |
| MEDIUM | ≥ 0.4 |
| LOW | < 0.4 |

### Outputs

| File | Purpose |
|------|---------|
| `data/churn_dashboard_data.json` | Dashboard data consumed by `server/services/cache.js` |
| `data/churn_model_ensemble.pkl` | Serialized ensemble model |
| `data/real_transactions.json` | Processed transaction data (optional, merged on startup) |
| `data/signals.csv` | Extracted signal features |

### Retrain Pipeline

1. Load last 6 months of data (or existing CSV)
2. Check 60-day-old predictions vs actuals
3. Retrain ensemble with new data
4. Compare new AUC vs current model
5. If improved: swap model, regenerate dashboard JSON
6. Run drift detection on feature distributions
7. Validate calibration (predicted prob vs actual churn rate)

### Dependencies

```
pip install lightgbm xgboost catboost scikit-learn pandas numpy
```

---

## 13. API Reference

### Data & Users

| Method | Path | Purpose | Rate Limit |
|--------|------|---------|------------|
| GET | `/healthz` | Health check | — |
| GET | `/api/data` | Full dashboard data (merged live + static) | 100/min |
| GET | `/api/users` | List users (filter: tier, corridor, search, sort, limit) | 100/min |
| GET | `/api/users/:id` | Single user detail | 100/min |
| GET | `/api/model` | Model metadata | 100/min |
| GET | `/api/model/health` | Model + backtest + health | 100/min |
| GET | `/api/data/health` | Data health checks | 100/min |
| GET | `/api/impact` | Revenue impact scenarios | 100/min |
| GET | `/api/shap` | SHAP feature importance | 100/min |
| GET | `/api/experiments` | A/B experiment data | 100/min |
| GET | `/api/compliance` | Compliance status | 100/min |
| GET | `/api/executive` | Executive summary (live-enriched) | 100/min |

### Live Data (Redshift)

| Method | Path | Purpose | Rate Limit |
|--------|------|---------|------------|
| GET | `/api/early-warnings` | Real-time churn risk signals | 100/min |
| GET | `/api/corridor-health` | Corridor performance | 100/min |
| GET | `/api/monthly-trends` | 12-month rolling trends | 100/min |
| GET | `/api/partner-performance` | Fulfillment partner stats | 100/min |
| GET | `/api/cohorts/new-users` | New user cohort tracking | 100/min |
| GET | `/api/prediction-validation` | Prediction vs actual | 100/min |
| POST | `/api/refresh` | Manual data refresh | 100/min |
| GET | `/api/refresh-status` | Check refresh state | 100/min |
| POST | `/api/metabase/query` | Direct Redshift query proxy (SELECT only) | **10/min** |

### Cohorts

| Method | Path | Purpose | Rate Limit |
|--------|------|---------|------------|
| GET | `/api/cohorts` | List all cohorts | 100/min |
| GET | `/api/cohorts/:key` | Single cohort detail | 100/min |
| GET | `/api/cohorts/:key/playbook` | Cohort retention playbook | 100/min |
| GET | `/api/cohorts/dropout` | Funnel dropout analysis | 100/min |

### Dossier & Scoring

| Method | Path | Purpose | Rate Limit |
|--------|------|---------|------------|
| GET | `/api/users/:id/dossier` | Full user recovery dossier (AI-enriched) | 100/min |
| POST | `/api/score/user` | Re-score a single user | 100/min |

### Campaigns & Interventions

| Method | Path | Purpose | Rate Limit |
|--------|------|---------|------------|
| POST | `/api/interventions/trigger` | Trigger single intervention (S3 audit) | 100/min |
| POST | `/api/interventions/outcome` | Record intervention outcome | 100/min |
| GET | `/api/interventions/log` | Intervention history (last 100) | 100/min |
| GET | `/api/campaigns/history` | Campaign audit trail (last 50) | 100/min |
| POST | `/api/moengage/engage` | Single user MoEngage intervention | 100/min |
| POST | `/api/moengage/bulk` | Bulk MoEngage campaign | 100/min |
| GET | `/api/cooldown/active` | All active cooldowns | 100/min |
| GET | `/api/cooldown/:userId` | Cooldown status for user | 100/min |
| POST | `/api/retell/call` | Retell.ai voice call | 100/min |
| POST | `/api/simulator` | Revenue impact simulator | 100/min |
| GET | `/api/integrations` | Integration connection status | 100/min |

### AI & Sentiment

| Method | Path | Purpose | Rate Limit |
|--------|------|---------|------------|
| POST | `/api/ai/risk-analysis` | LLM risk analysis (batch up to 20) | 100/min |
| POST | `/api/ai/brief` | AI-generated user brief | 100/min |
| POST | `/api/ai/chat` | Conversational churn intelligence | 100/min |
| GET | `/api/users/:id/sentiment` | User support sentiment analysis | 100/min |
| GET | `/api/sentiment/summary` | Bulk sentiment for all users | 100/min |
| GET | `/api/decagon` | Browse Decagon support conversations | 100/min |

### Mixpanel

| Method | Path | Purpose | Rate Limit |
|--------|------|---------|------------|
| POST | `/api/mixpanel/funnel` | Query specific funnel | 100/min |
| GET | `/api/mixpanel/overview` | Cached funnels + engage stats + daily snapshot | 100/min |
| GET | `/api/mixpanel/funnels` | List available funnels | 100/min |

### Docs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api-docs` | Swagger UI |

---

## 14. Troubleshooting

### MoEngage Push

| Symptom | Cause | Fix |
|---------|-------|-----|
| Push returns 401 | Incorrect signature | Verify signature = `SHA256(MOENGAGE_APP_ID\|campaignName\|MOENGAGE_API_KEY)` — pipe-delimited, no spaces |
| `targetUserAttributes is Mandatory` | Missing `targetUserAttributes` in payload | Ensure `targetUserAttributes` object includes `attribute`, `comparisonParameter`, `attributeValue` |
| TTL error | TTL value out of range | Must be 0–672 (hours). Current setting: `{ ANDROID: 672 }` |
| Push to multiple users fails | `comparisonParameter` mismatch | Use `'is'` for single user, `'in'` for array of user IDs |

### Cooldown System

| Symptom | Cause | Fix |
|---------|-------|-----|
| 409 after manual DB delete | In-memory cache still holds old entry | **Restart backend** — cooldown `Map` is loaded from DB only on startup |
| Lock timeout (429) | Concurrent requests for same user | Retry after a few seconds; lock auto-releases |
| Cooldowns not persisting | PG not configured | Set `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` env vars |

### Redshift

| Symptom | Cause | Fix |
|---------|-------|-----|
| Connection timeout on startup | VPC/security group blocks access | Verify security group allows inbound on port 5439 from server IP |
| `Too many connections` | Pool exhaustion | Check for leaked clients; max pool is 5 connections |
| Query fails with "Unknown query" | Invalid `query_key` | Use one of: `monthly_trends`, `corridor_health`, `partner_performance`, `new_user_cohorts`, `prediction_validation`, `early_warnings`, `decagon_conversations`, `delivery` |
| `prediction_validation` skipped | Table doesn't exist yet | Expected — this query fails silently until the predictions table is created |

### Mixpanel

| Symptom | Cause | Fix |
|---------|-------|-----|
| 429 rate limited | Too many API calls | Wait and retry; refresh runs every 6h — avoid manual `POST /api/refresh` spam |
| Funnel returns empty data | Wrong date range or funnel ID | Verify funnel IDs in `server/config.js` → `MIXPANEL_FUNNELS` |
| "Not configured" response | `MIXPANEL_API_SECRET` not set | Set `MIXPANEL_API_SECRET` env var |

### S3

| Symptom | Cause | Fix |
|---------|-------|-----|
| `{ mock: true }` in responses | S3 not configured | Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `AWS_REGION` |
| Write fails with AccessDenied | IAM permissions | Ensure the IAM user/role has `s3:PutObject` on the target bucket |
| Write fails with NoSuchBucket | Wrong bucket name | Verify `S3_BUCKET` env var matches an existing bucket |

### AI

| Symptom | Cause | Fix |
|---------|-------|-----|
| All responses show `source: "rule_based"` | `ANTHROPIC_API_KEY` not set | Set `ANTHROPIC_API_KEY` env var |
| Risk analysis returns stale data | Cache not expired | Cache TTL is 5 minutes — wait or restart backend |
| "User not found" in risk analysis | User ID not in index | Verify user exists in `data/churn_dashboard_data.json` or `data/real_transactions.json` |

### Retell.ai

| Symptom | Cause | Fix |
|---------|-------|-----|
| `{ mock: true }` responses | `RETELL_API_KEY` or `RETELL_AGENT_ID` not set | Set both env vars |
| Call initiation fails | Invalid phone number or API error | Check Retell.ai dashboard for call logs; verify phone format |
