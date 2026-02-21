# ShieldXChurn

**Churn prediction & retention intelligence platform** for [Vance](https://vance.club) — identifies at-risk users on the NRI remittance platform using behavioral signals (Mixpanel), transactional data (Redshift), and AI-powered interventions (Claude, MoEngage, Retell.ai).

[![Tests](https://img.shields.io/badge/tests-136%20passing-brightgreen)](#testing)
[![Python](https://img.shields.io/badge/python-3.12-blue)](#quick-start)
[![Node](https://img.shields.io/badge/node-18+-green)](#quick-start)
[![API](https://img.shields.io/badge/API-52%20endpoints-orange)](#api-endpoints)
[![Model](https://img.shields.io/badge/model-AUC%200.941-purple)](#ml-pipeline)

## Team

- **Team Name:** Codeaspora
- **Members:** Abhishek PR (Full-Stack Engineer & ML)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/JS SPA (10-tab dark-themed dashboard) |
| Backend | Node.js 18+ (Express 5), Python 3.12+ |
| AI/ML | Claude Haiku 4.5, Gemini 2.0 Flash, OpenRouter, LightGBM + XGBoost + CatBoost ensemble |
| Data/Infra | Amazon Redshift, PostgreSQL, Mixpanel, AWS S3 |
| Engagement | MoEngage (push/SMS/email/WhatsApp), Retell.ai (AI voice calls) |

## Quick Start

See [`RUNBOOK.md`](RUNBOOK.md) for full setup and verification steps. Estimated time: ~10 minutes.

---

## Architecture

```
Browser → Frontend (:3000) → Backend (:3001)
                                  ↓
                    Routes (data, live, cohorts, dossier, campaigns, ai, predictions)
                                  ↓
                    Service Layer (cache, redshift, sentiment, campaign, ai, rules, gemini, llm-cost, drift)
                                  ↓
              ┌─────────┬──────────┬─────────┬──────────┬─────────────┬─────────────┐
         Redshift(prod) LocalPG   Mixpanel   S3       MoEngage    LLM Gateway
         (txns,data)  (predictions,          (audit)  (engage)    (OpenRouter→
                       llm_usage)                                  Gemini/Haiku)
              └─────────┴──────────┴─────────┴──────────┴─────────────┴─────────────┘
```

#### Tiered Scoring Flow

```
User Score → determineTier() → T2 Rule Engine ($0, all users)
                              → T5 Gemini Flash (~$0.001, CRITICAL/HIGH)
                              → T6 Haiku (~$0.005, edge 0.38-0.42)
                              → OpenRouter fallback for T5/T6
```

#### Python ML Pipeline (offline)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Python ML Pipeline (offline)                        │
│                                                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────┐│
│  │ extract_signals │  │  train_model   │  │ process_transactions       ││
│  │ (Mixpanel →    │  │ (LightGBM +    │  │ (CSV → risk tiers →       ││
│  │  43 features)  │→│  XGBoost +     │→│  JSON artifacts)           ││
│  │                │  │  CatBoost +    │  │                            ││
│  │                │  │  LogReg meta)  │  │                            ││
│  └────────────────┘  └────────────────┘  └────────────────────────────┘│
│                                                                         │
│  src/churn/ (Clean Architecture)                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ domain/  │  │ service/ │  │  infra/  │  │   cli/   │               │
│  │ (pure    │←│ (orches- │←│ (adapters│  │  (Rich   │               │
│  │  logic)  │  │  tration)│  │  to APIs)│  │  output) │               │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Design Decisions

| ID | Decision | Constraint |
|----|----------|------------|
| [DEC-001](DECISIONS.md) | Clean Architecture (domain/infra/service/cli) | No I/O imports in domain/ |
| [DEC-002](DECISIONS.md) | Frozen dataclasses for domain models | Never mutate after construction |
| [DEC-007](DECISIONS.md) | Ensemble ML (3 base + meta-learner) | Always retrain all models together |
| [DEC-009](DECISIONS.md) | Dual backend (Python ML + Node API) | Never duplicate logic between them |
| [DEC-010](DECISIONS.md) | 4-tier risk discretization | Map scores to tiers for operations |
| [DEC-013](DECISIONS.md) | Tiered LLM (rule engine + Gemini Flash + Haiku) | T2 free for all; T5/T6 only when score warrants cost |
| [DEC-014](DECISIONS.md) | Self-learning feedback loop (60-day window) | Evaluate predictions after 60 days; never auto-deploy retraining (GR-009) |

Full list: [DECISIONS.md](DECISIONS.md) (14 decisions) | [GUARDRAILS.md](GUARDRAILS.md) (11 anti-patterns)

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- Access to Redshift, Mixpanel, AWS (credentials in `.env`)

### Setup

```bash
# Clone & install
git clone <repo-url> && cd sheildxchurn
pip install -e ".[dev]"
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your keys (see Environment Variables below)

# Process seed data (if you have a transactions CSV)
python scripts/process_transactions.py

# Start the server
node server/index.js
```

### Verify

```bash
# Health check (backend)
curl http://localhost:3001/healthz

# Dashboard (frontend)
open http://localhost:3000

# Swagger API docs (backend)
open http://localhost:3001/api-docs

# Run all tests (136 total)
make check
```

---

## Dashboard

10-tab single-page application served at `/` — dark theme, real-time data.

| Tab | Purpose |
|-----|---------|
| **Warroom** | Executive summary: at-risk users, churn rate, risk distribution, top cohorts |
| **Explorer** | Search & filter users by tier, corridor, status; sort by probability |
| **Dossier** | Individual user deep-dive: AI summary, SHAP drivers, nudge sequence, sentiment |
| **Playbooks** | Cohort-level retention strategies with expected lift and cost |
| **Model** | ML health: AUC, precision, recall, backtest results, feature importance |
| **Live** | Real-time Redshift: early warnings, corridor health, monthly trends, partner stats |
| **Campaigns** | Intervention history, MoEngage/Retell integration, audit trail |
| **Simulator** | Revenue impact modeling: target cohort, playbook, budget → projected ROI |
| **Sentiment** | Support conversation analysis: frustrated users, pain points, Decagon browse |
| **Config** | Integration status (6 services), compliance, data health |

---

## API Endpoints

**52 endpoints** across 8 categories. Full OpenAPI 3.0.3 spec at [`/api-docs`](http://localhost:3000/api-docs).

### Data & Model (10)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data` | Dashboard summary (merged cache + live Redshift) |
| GET | `/api/users` | User list with filtering (`?tier=CRITICAL&corridor=UAE_IN&limit=20`) |
| GET | `/api/users/:id` | Single user details |
| GET | `/api/model` | ML model metadata |
| GET | `/api/model/health` | Model health + backtest |
| GET | `/api/impact` | Revenue impact scenarios |
| GET | `/api/shap` | SHAP feature importance |
| GET | `/api/cohorts` | All cohorts |
| GET | `/api/cohorts/:key` | Single cohort |
| GET | `/api/cohorts/:key/playbook` | Cohort retention playbook |

### Live Data (6)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/early-warnings` | Real-time churn risk signals |
| GET | `/api/corridor-health` | Corridor performance (users, success rate, delivery) |
| GET | `/api/monthly-trends` | 12-month rolling trends |
| GET | `/api/partner-performance` | Fulfillment partner stats |
| GET | `/api/cohorts/new-users` | New user cohort tracking |
| GET | `/api/refresh-status` | Data freshness & next refresh |

### Campaigns & Interventions (8)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/interventions/trigger` | Trigger single-user intervention |
| POST | `/api/interventions/outcome` | Log outcome (retained/churned/no_response) |
| GET | `/api/interventions/log` | Audit trail |
| GET | `/api/campaigns/history` | Campaign history with S3 status |
| POST | `/api/moengage/engage` | Send via MoEngage (single) |
| POST | `/api/moengage/bulk` | Bulk send to risk tier |
| POST | `/api/retell/call` | AI voice call via Retell.ai |
| POST | `/api/simulator` | Revenue simulator |

### AI & Sentiment (9)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/:id/sentiment` | User sentiment from support history |
| GET | `/api/sentiment/summary` | Bulk sentiment summary |
| POST | `/api/ai/brief` | AI-generated retention brief (Claude) |
| POST | `/api/ai/chat` | Chat with platform context |
| POST | `/api/ai/risk-analysis` | Batch LLM risk analysis with tiered processing (T2/T5/T6, up to 20 users) |
| GET | `/api/decagon` | Browse Decagon conversations |
| GET | `/api/users/:id/dossier` | Full recovery dossier (AI + sentiment + SHAP) |
| POST | `/api/score/user` | Score single user |
| GET | `/api/executive` | Executive summary |

### Scoring & Dossier (3)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/score/user` | Score user → churn_probability, risk_tier, reasons |
| GET | `/api/users/:id/dossier` | Full dossier: AI summary, LLM risk signals, nudge plan |
| GET | `/api/executive` | Executive impact: total users, churn rate, revenue at risk |

### Predictions & Feedback (7)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/predictions/write` | Batch write scored predictions (idempotent) |
| POST | `/api/predictions/evaluate` | Evaluate 60-day outcomes |
| GET | `/api/predictions/drift` | Model drift status + governance |
| GET | `/api/predictions/cost` | LLM cost summary (per-tier breakdown) |
| GET | `/api/predictions/analyze-rules` | Analyze rule effectiveness vs actual outcomes |
| POST | `/api/predictions/propose-rules` | Generate rule change proposals (weights, thresholds, new rules) |
| POST | `/api/predictions/apply-rules` | Apply proposals → git branch + commit + push + create PR (GR-009) |

### Utility (5)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Server health |
| GET | `/api/integrations` | Integration status (6 services) |
| POST | `/api/metabase/query` | Redshift query proxy (SELECT-only) |
| POST | `/api/refresh` | Manual data refresh |
| GET | `/api/compliance` | GDPR compliance & audit info |

---

## ML Pipeline

### Ensemble Model

```
                    ┌─────────────┐
   43 features ───→│  LightGBM   │───→ P₁
                    └─────────────┘
                    ┌─────────────┐
   43 features ───→│   XGBoost   │───→ P₂  ──→ ┌──────────────┐ ──→ churn_probability
                    └─────────────┘              │ LogReg Meta  │
                    ┌─────────────┐              │   Learner    │
   43 features ───→│  CatBoost   │───→ P₃  ──→ └──────────────┘
                    └─────────────┘
```

| Metric | Train | Validation | Test |
|--------|-------|------------|------|
| AUC | 0.967 | 0.945 | **0.941** |
| Precision | 0.89 | 0.85 | **0.84** |
| Recall | 0.91 | 0.88 | **0.87** |

### Risk Tiers

| Tier | Threshold | Intervention | Cost/User |
|------|-----------|-------------|-----------|
| CRITICAL | ≥ 0.80 | support_callback + speed_guarantee | $15 |
| HIGH | 0.60–0.79 | loyalty_discount + priority_queue | $8 |
| MEDIUM | 0.40–0.59 | re_engagement email sequence | $3 |
| LOW | < 0.40 | No intervention (monitor) | $0 |

### Tiered Scoring Architecture

| Tier | Model | Trigger | Cost | Monthly @5M users |
|------|-------|---------|------|--------------------|
| T2 | Rule engine (25 rules from `server/rules.yaml`) | All users | $0 | $0 |
| T5 | Gemini 2.0 Flash (via OpenRouter fallback) | CRITICAL or HIGH (score >= 0.60) | ~$0.001/user | ~$15 |
| T6 | Claude Haiku (via OpenRouter fallback) | Edge cases (score 0.38-0.42) | ~$0.005/user | ~$5 |

**Kill switch:** Set `ENABLE_GEMINI=false` to disable T5. Missing API keys gracefully degrade to T2.

**Self-learning loop:** Predictions stored in local PostgreSQL, evaluated after 60 days against actual transaction activity. Drift detection triggers retraining recommendations (never auto-deployed per GR-009).

### 43 Signal Features (8 categories)

| Category | Features | Examples |
|----------|----------|---------|
| User Properties | 5 | tenure_days, corridor, kyc_verified |
| Engagement | 6 | app_opens_l30, session_freq_ratio, days_since_last_event |
| Transactions | 8 | total_orders, tx_frequency_ratio, avg_send_amount |
| Funnel | 5 | onboarding_completion, checkout_dropoff_rate |
| Friction | 6 | fail_rate, stuck_rate, avg_delivery_min, help_opens_l30 |
| Journey | 5 | screens_per_session, unique_screens_l30 |
| Timing | 4 | days_since_last, hour_preference, weekend_ratio |
| Interactions | 4 | referral_sent, promo_used, notification_clicks |

Full specification: [SIGNALS.md](SIGNALS.md)

### Pipeline Scripts

| Script | Purpose | Input → Output |
|--------|---------|----------------|
| `scripts/extract_signals.py` | Extract 43 features from Mixpanel | Mixpanel API → `features.csv` |
| `scripts/train_model.py` | Train ensemble model | `features.csv` + Redshift labels → `model.pkl` |
| `scripts/retrain.py` | Retrain on latest data | Mixpanel + Redshift → updated `model.pkl` |
| `scripts/process_transactions.py` | Process raw transactions | `transactions.csv` → `real_transactions.json` |

---

## Data Pipeline

### Pipeline 1: Offline ML Training (Python)

`train_model.py` produces ML scores that feed into `process_transactions.py` for final user scoring.

```
┌──────────────┐     ┌──────────────────┐
│  Mixpanel    │     │  Redshift (prod) │
│  Export API  │     │  analytics_      │
│  + Engage    │     │  orders_master   │
└──────┬───────┘     └────────┬─────────┘
       │                      │
       ▼                      ▼
┌──────────────┐     ┌────────────────┐
│ extract_     │     │ train_model.py │
│ signals.py   │────▶│ (LightGBM +   │
│ (43 features)│     │  XGBoost +     │
│              │     │  CatBoost +    │
│              │     │  LogReg meta)  │
└──────────────┘     └───────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ model.pkl    │ │ model_user_  │ │ churn_dash-  │
     │ (ensemble    │ │ scores.json  │ │ board_data   │
     │  weights)    │ │ (per-user ML │ │ .json (model │
     │              │ │  churn_prob  │ │  SHAP, exec) │
     │ Used by:     │ │  + risk_tier)│ │              │
     │ retrain.py   │ └──────┬───────┘ └──────┬───────┘
     └──────────────┘        │                │
                             ▼                │
              ┌──────────────────────────┐    │
              │ process_transactions.py  │    │
              │                          │    │
              │ Inputs:                  │    │
              │ • transactions_500k.csv  │    │
              │ • model_user_scores.json │    │
              │                          │    │
              │ Per-user: if ML score    │    │
              │ exists → use it; else    │    │
              │ heuristic fallback       │    │
              └────────────┬─────────────┘    │
                           │                  │
                           ▼                  │
              ┌──────────────────────────┐    │
              │ data/                    │    │
              │ ├─ real_transactions     │    │
              │ │  .json (59K users,    │◀───┘
              │ │  ML-scored, cohorts)  │
              │ ├─ churn_dashboard_     │
              │ │  data.json (metrics)  │
              │ └─ retrain_report.json  │
              └────────────┬─────────────┘
                           │
                           ▼
              ┌──────────────────────────┐
              │ cache.js                 │
              │ (startup: loads JSONs →  │
              │  userIndex → merges with │
              │  live Redshift data)     │
              └──────────────────────────┘
```

> **Scoring precedence:** `process_transactions.py` loads `model_user_scores.json` (ML ensemble
> predictions from `train_model.py`). Users with ML scores use ensemble churn_probability;
> users not in the model output fall back to heuristic `compute_risk_score()` from domain layer.

### Pipeline 2: Online Tiered Scoring (Node.js, per-request)

```
                              ┌──────────────────────────────────┐
                              │         API Request              │
                              │  POST /api/ai/risk-analysis      │
                              │  { userIds: [...] }              │
                              └───────────────┬──────────────────┘
                                              │
                                              ▼
                              ┌──────────────────────────────────┐
                              │  runRiskAnalysis(userId)          │
                              │  ① Check 5-min cache             │
                              │  ② Lookup user in userIndex      │
                              │  ③ evaluateRules(user) → signals │
                              │  ④ determineTier(score, tier)     │
                              └───────────────┬──────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
        ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
        │     T2: Rules     │   │   T5: Gemini Flash │   │   T6: Haiku       │
        │  (all other users)│   │  (CRITICAL / HIGH) │   │  (edge 0.38-0.42) │
        │                   │   │                    │   │                    │
        │  25 YAML rules    │   │  Direct Gemini API │   │  Direct Anthropic  │
        │  from rules.yaml  │   │     ↓ (429?)       │   │     ↓ (401?)       │
        │                   │   │  OpenRouter         │   │  OpenRouter        │
        │  Cost: $0         │   │  (gemini-2.0-flash) │   │  (claude-3.5-haiku)│
        │                   │   │     ↓ (fail?)       │   │     ↓ (fail?)       │
        │                   │   │  Fallback → T2      │   │  Fallback → T2     │
        └────────┬──────────┘   └─────────┬──────────┘   └─────────┬──────────┘
                 │                        │                         │
                 └────────────────────────┼─────────────────────────┘
                                          │
                                          ▼
                              ┌──────────────────────────────────┐
                              │  Response: { risk_signals,       │
                              │    intervention_plan, justifi-   │
                              │    cation, urgency, confidence,  │
                              │    source, tier, cost }          │
                              └───────────────┬──────────────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                                       ▼
               ┌────────────────────┐                  ┌────────────────────┐
               │  In-memory cache   │                  │  llm-cost.js       │
               │  riskAnalysisCache │                  │  → recordCost()    │
               │  (5-min TTL)       │                  │  → local PG:       │
               └────────────────────┘                  │    churn_llm_usage │
                                                       └────────────────────┘
```

### Pipeline 3: Live Data Refresh (6-hour cycle)

```
              ┌────────────────────────────────────────────────────────┐
              │                 6-hour refresh interval                 │
              │                 (REFRESH_INTERVAL)                      │
              └───────────────────────┬────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                                     ▼
         ┌────────────────────┐                ┌────────────────────┐
         │  Redshift (prod)   │                │  Mixpanel          │
         │                    │                │                    │
         │  7 queries:        │                │  5 funnels:        │
         │  • early_warnings  │                │  • onboarding      │
         │  • corridor_health │                │  • activation      │
         │  • monthly_trends  │                │  • uae_onboarding  │
         │  • partner_perf    │                │  • uk_onboarding   │
         │  • new_users       │                │  • us_onboarding   │
         │  • at_risk_users   │                │                    │
         │  • volume_summary  │                │  + Engage profiles │
         └─────────┬──────────┘                └─────────┬──────────┘
                   │                                     │
                   └──────────────┬──────────────────────┘
                                  ▼
                       ┌────────────────────┐
                       │  redshiftCache {}   │
                       │  mixpanelCache {}   │
                       │  (merged into       │
                       │   /api/data resp)   │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │  drift.js          │
                       │  checkDrift()      │
                       │  (reads retrain_   │
                       │   report.json,     │
                       │   logs warnings if │
                       │   AUC drops >5%    │
                       │   for 2+ runs)     │
                       └────────────────────┘
```

### Pipeline 4: Self-Learning Feedback Loop

```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                        Prediction Lifecycle                             │
   │                                                                         │
   │  ① WRITE                    ② EVALUATE (60 days)    ③ DRIFT CHECK      │
   │                                                                         │
   │  POST /predictions/write    POST /predictions/      GET /predictions/   │
   │         │                    evaluate                drift              │
   │         ▼                         │                       │             │
   │  ┌──────────────┐                ▼                       ▼             │
   │  │ Local PG:    │    ┌──────────────────────┐   ┌─────────────────┐   │
   │  │ churn_       │    │ Cross-DB evaluation:  │   │ retrain_report  │   │
   │  │ predictions  │    │                       │   │ .json           │   │
   │  │              │    │ 1. Fetch completed    │   │                 │   │
   │  │ • user_id    │    │    users from prod    │   │ • AUC baseline  │   │
   │  │ • score      │    │    Redshift (60d)     │   │ • consecutive   │   │
   │  │ • risk_tier  │    │ 2. Match against      │   │   runs tracking │   │
   │  │ • model_ver  │    │    predictions in     │   │ • z-score per   │   │
   │  │ • rule_ver   │    │    local PG           │   │   feature       │   │
   │  │ • top_reasons│    │ 3. UPDATE actual_     │   │ • alert if      │   │
   │  │ • predicted  │    │    outcome =          │   │   AUC < 0.90    │   │
   │  │   _at        │    │    'retained' or      │   │   for 2+ runs   │   │
   │  │              │    │    'churned'           │   │                 │   │
   │  └──────────────┘    └──────────────────────┘   └─────────────────┘   │
   │                                                                         │
   │  ④ COST TRACKING                                                       │
   │                                                                         │
   │  GET /predictions/cost                                                  │
   │         │                                                               │
   │         ▼                                                               │
   │  ┌──────────────────────────────────────────────────────────┐          │
   │  │ Dual-write cost tracking:                                 │          │
   │  │                                                           │          │
   │  │ In-memory (hot):  rolling 24h → GET /predictions/cost     │          │
   │  │ Local PG (cold):  churn_llm_usage → 30d aggregation       │          │
   │  │                                                           │          │
   │  │ Breakdown by: tier (T2/T5/T6), model, calls, tokens, $   │          │
   │  └──────────────────────────────────────────────────────────┘          │
   │                                                                         │
   │  ⑤ RULE EVOLUTION (human-in-the-loop) — server/services/rule-evolution.js │
   │                                                                         │
   │  GET /analyze-rules         POST /propose-rules      POST /apply-rules  │
   │         │                         │                         │           │
   │         ▼                         ▼                         ▼           │
   │  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────────┐  │
   │  │ Query local   │    │ Compare rules vs │    │ Git workflow:        │  │
   │  │ PG for eval'd │───▶│ outcomes:        │───▶│                      │  │
   │  │ predictions   │    │                  │    │ 1. Branch: feat/     │  │
   │  │               │    │ • Per-rule       │    │    rules-v{N}        │  │
   │  │ Per-rule:     │    │   precision      │    │ 2. Apply changes to  │  │
   │  │ • fired count │    │ • Weak rules     │    │    rules.yaml        │  │
   │  │ • correct     │    │   (prec < 0.3)   │    │ 3. Commit + push     │  │
   │  │   churns      │    │   → reduce weight│    │ 4. Create PR via     │  │
   │  │ • false       │    │ • Strong rules   │    │    GitHub REST API   │  │
   │  │   positives   │    │   (prec > 0.7)   │    │    (GITHUB_TOKEN)    │  │
   │  │ • precision   │    │   → boost weight │    │ 5. Human reviews     │  │
   │  │               │    │ • Missed churns  │    │    and merges         │  │
   │  │ Per-tier:     │    │   → lower thresh │    │    (GR-009: never    │  │
   │  │ • accuracy    │    │ • New rules for  │    │    auto-merge)       │  │
   │  │ • churn rate  │    │   undetected     │    │ 6. On merge: new     │  │
   │  │               │    │   patterns       │    │    rule_version hash │  │
   │  └──────────────┘    └──────────────────┘    └──────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────┘
```

### Dual Database Architecture

```
┌─────────────────────────────────────┐   ┌─────────────────────────────────┐
│       Redshift (Production)         │   │       Local PostgreSQL          │
│  redshift-cluster.*.redshift.aws    │   │       localhost:5439            │
│                                     │   │                                 │
│  READ-ONLY from Node.js:           │   │  READ + WRITE from Node.js:    │
│  • analytics_orders_master_data     │   │  • churn_predictions           │
│  • early warnings queries           │   │    (59K users per model ver)   │
│  • corridor health                  │   │  • churn_llm_usage             │
│  • monthly trends                   │   │    (per-call LLM cost log)     │
│  • partner performance              │   │  • cooldowns                   │
│  • at-risk user signals             │   │    (intervention cooldown)     │
│                                     │   │                                 │
│  Pool: redshiftPool (SSL)           │   │  Pool: localPgPool (no SSL)    │
│  Config: REDSHIFT_*                 │   │  Config: LOCAL_PG_*            │
└─────────────────────────────────────┘   └─────────────────────────────────┘
```

---

## Integrations

| Service | Purpose | Config Env Var |
|---------|---------|---------------|
| **Redshift** | Transaction data, corridor metrics, user features | `REDSHIFT_HOST`, `REDSHIFT_USER`, `REDSHIFT_PASSWORD`, `REDSHIFT_DB` |
| **Mixpanel** | Behavioral events (Export API) + user profiles (Engage API) | `MIXPANEL_API_SECRET`, `MIXPANEL_TOKEN`, `MIXPANEL_PROJECT_ID` |
| **Anthropic** | T6 edge-case risk analysis (Claude Haiku, score 0.38-0.42) | `ANTHROPIC_API_KEY` |
| **Gemini Flash** | T5 risk enrichment for CRITICAL/HIGH users | `GEMINI_API_KEY`, `ENABLE_GEMINI` |
| **OpenRouter** | LLM gateway fallback (Gemini + Haiku via OpenRouter) | `OPENROUTER_KEY` |
| **Local PostgreSQL** | Predictions + LLM cost tracking (dual pool) | `LOCAL_PG_HOST`, `LOCAL_PG_PORT`, `LOCAL_PG_USER`, `LOCAL_PG_PASSWORD`, `LOCAL_PG_DB` |
| **MoEngage** | User engagement delivery (push, SMS, email, WhatsApp) | `MOENGAGE_APP_ID`, `MOENGAGE_API_KEY`, `MOENGAGE_DATA_API_KEY` |
| **Retell.ai** | AI voice calls for retention outreach | `RETELL_API_KEY`, `RETELL_AGENT_ID` |
| **AWS S3** | Campaign audit trail storage | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` |

---

## Testing

**136 tests** across two runtimes — zero external dependencies required.

```bash
# All tests
make check

# Python only (66 tests, 15 files)
pytest tests/ -v

# Node.js only (70 tests, 8 suites)
npx jest --verbose

# Python coverage
make coverage
```

### Python Tests (66)

| Layer | Tests | Focus |
|-------|-------|-------|
| `tests/domain/` | Risk tiers, funnel analysis, session building, constants | Pure logic, no mocks |
| `tests/infra/` | Config loading, Mixpanel client, Redshift connector | Mock external APIs |
| `tests/service/` | End-to-end analysis pipeline | Integration of domain + infra |
| `tests/cli/` | CLI argument parsing, output formatting | Presentation layer |

### Node.js Tests (70)

| Suite | Tests | Focus |
|-------|-------|-------|
| `routes/data` | Dashboard data, users, impact | API response shape |
| `routes/campaigns` | Simulator, interventions | Campaign logic |
| `services/sentiment` | Decagon CSV parsing, rule-based sentiment | NLP pipeline |
| `services/ai` | Claude brief/chat fallbacks | AI service resilience |
| `lib/logger` | Structured logging, baseCtx, request correlation | Observability |
| `lib/validate` | Input validation (tier, limit, search) | Security boundary |
| `lib/csv-parser` | CSV parsing, escaping | Data loading |
| `integration/app` | Server startup, route registration | Smoke tests |

---

## Project Structure

```
sheildxchurn/
├── src/churn/                    # Python domain (Clean Architecture)
│   ├── domain/                   # Pure business logic — zero I/O
│   │   ├── constants.py          # 43 signals, risk tiers, corridors, interventions
│   │   ├── risk.py               # Risk tier classification & heuristic scoring
│   │   ├── funnel.py             # Order-preserving funnel analysis
│   │   ├── session.py            # Session building & drop-off detection
│   │   └── models.py             # Frozen dataclasses (ScreenEvent, Session, etc.)
│   ├── infra/                    # Adapters to external systems
│   │   ├── config.py             # YAML + env var layered config
│   │   ├── mixpanel.py           # Export API + Engage API client
│   │   └── redshift.py           # redshift_connector adapter
│   ├── service/                  # Orchestration
│   │   └── analysis.py           # Funnel + drop-off analysis pipeline
│   └── cli/                      # Presentation
│       └── main.py               # Rich CLI interface
│
├── server/                       # Node.js Express API
│   ├── index.js                  # Server entry, middleware, Swagger UI
│   ├── config.js                 # Env + constants loader
│   ├── types.js                  # JSDoc shared type definitions (14 types)
│   ├── openapi.yaml              # OpenAPI 3.0.3 spec (49 endpoints)
│   ├── constants.json            # Generated from Python domain constants
│   ├── rules.yaml                # 25 config-driven signal rules for T2 scoring
│   ├── routes/                   # API route handlers
│   │   ├── data.js               # /api/data, /users, /model, /impact, /cohorts
│   │   ├── dossier.js            # /api/users/:id/dossier, /score, /executive
│   │   ├── live.js               # /api/early-warnings, /corridor-health, /trends
│   │   ├── campaigns.js          # /api/interventions, /moengage, /retell, /simulator
│   │   ├── ai.js                 # /api/ai/brief, /chat, /risk-analysis, /sentiment
│   │   └── predictions.js        # /api/predictions/write, /evaluate, /drift, /cost
│   ├── services/                 # Business logic
│   │   ├── cache.js              # In-memory data cache + userIndex
│   │   ├── redshift.js           # Connection pool + query refresh
│   │   ├── sentiment.js          # Decagon CSV + rule-based + LLM sentiment
│   │   ├── campaign.js           # S3 audit trail, MoEngage/Retell integration
│   │   ├── ai.js                 # Claude API (brief, chat, risk analysis)
│   │   ├── rules.js              # T2 rule engine (evaluates rules.yaml signals)
│   │   ├── gemini.js             # T5 Gemini Flash risk enrichment via OpenRouter
│   │   ├── llm-cost.js           # LLM cost tracking per tier (local PG)
│   │   ├── drift.js              # Model drift detection + governance
│   │   ├── rule-evolution.js     # Rule analysis, proposals, and PR creation
│   │   └── mixpanel.js           # Mixpanel funnel queries
│   ├── lib/                      # Utilities
│   │   ├── logger.js             # Structured JSON logging with request correlation
│   │   ├── validate.js           # Input validation
│   │   └── csv-parser.js         # CSV parsing
│   └── __tests__/                # Jest test suites (8 files, 70 tests)
│
├── scripts/                      # ML pipeline scripts
│   ├── extract_signals.py        # Feature extraction from Mixpanel
│   ├── train_model.py            # Ensemble model training
│   ├── retrain.py                # Model retraining pipeline
│   └── process_transactions.py   # CSV → scored JSON artifacts
│
├── public/                       # Frontend dashboard
│   └── index.html                # 10-tab SPA (800+ lines)
│
├── tests/                        # Python test suite (15 files, 66 tests)
├── data/                         # Data artifacts (gitignored)
│   ├── transactions_500k.csv     # Raw seed data
│   ├── real_transactions.json    # Processed: 59K users, cohorts, tiers
│   └── churn_dashboard_data.json # Model metadata, SHAP, executive impact
│
├── CLAUDE.md                     # Agent instructions (Claude Code)
├── DECISIONS.md                  # 14 architectural decisions
├── GUARDRAILS.md                 # 11 anti-patterns
├── DOMAIN_CONTEXT.md             # Churn prediction & remittance terminology
├── SIGNALS.md                    # 43-feature specification
├── config.yaml                   # Domain config (funnels, thresholds)
├── Makefile                      # Build automation
├── package.json                  # Node.js dependencies
├── pyproject.toml                # Python build config
└── .env                          # Credentials (gitignored)
```

---

## Environment Variables

```bash
# AI
ANTHROPIC_API_KEY=sk-ant-...

# Tiered Scoring
GEMINI_API_KEY=...           # Gemini Flash for T5 risk enrichment
ENABLE_GEMINI=true           # Kill switch: set to 'false' to disable Gemini
OPENROUTER_KEY=sk-or-...     # OpenRouter fallback for T5/T6

# Local PostgreSQL (predictions + LLM costs)
LOCAL_PG_HOST=localhost
LOCAL_PG_PORT=5439
LOCAL_PG_USER=redshift_admin
LOCAL_PG_PASSWORD=...
LOCAL_PG_DB=churndb

# Data
REDSHIFT_HOST=cluster.region.redshift.amazonaws.com
REDSHIFT_PORT=5439
REDSHIFT_USER=user
REDSHIFT_PASSWORD=pass
REDSHIFT_DB=dev

# Analytics
MIXPANEL_API_SECRET=...
MIXPANEL_TOKEN=...
MIXPANEL_PROJECT_ID=...

# Engagement
MOENGAGE_APP_ID=...
MOENGAGE_API_KEY=...
MOENGAGE_DATA_API_KEY=...
MOENGAGE_API_URL=https://api-01.moengage.com

# Voice
RETELL_API_KEY=key_...
RETELL_AGENT_ID=agent_...

# Storage
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=bucket-name
AWS_REGION=ap-south-1
```

---

## Corridors

Three active remittance corridors:

| Corridor | Code | Description |
|----------|------|-------------|
| UAE → India | `UAE_IN` | Largest volume, highest success rate |
| UK → India | `UK_IN` | Highest average send amount |
| USA → India | `US_IN` | Growing corridor, longest delivery times |

---

## Cortex Standards

This project follows the [Aspora Cortex](CLAUDE.md) engineering framework:

| File | Purpose |
|------|---------|
| [CLAUDE.md](CLAUDE.md) | Core engineering principles (loaded by Claude Code) |
| [DECISIONS.md](DECISIONS.md) | 14 architectural decisions — read before any task |
| [GUARDRAILS.md](GUARDRAILS.md) | 11 anti-patterns — don't repeat these mistakes |
| [DOMAIN_CONTEXT.md](DOMAIN_CONTEXT.md) | Churn prediction & remittance terminology |
| [SIGNALS.md](SIGNALS.md) | 43-feature specification |

---

## License

Proprietary — Vance Technologies.
