# Solution

## Approach

ShieldXChurn is a full-stack churn prediction and retention intelligence platform for Vance's NRI remittance business. A Python ML pipeline extracts 43 behavioral features from Mixpanel and trains an ensemble model (LightGBM + XGBoost + CatBoost + LogReg meta-learner, AUC 0.941). A Node.js Express API serves predictions through a 10-tab operational dashboard with tiered LLM scoring: T2 rule engine at $0 for all users, T5 Gemini Flash for high-risk users (~$0.001/user), and T6 Claude Haiku for boundary edge cases (~$0.005/user). Interventions are delivered via MoEngage push notifications and Retell.ai voice calls, with S3 audit trails and a self-learning feedback loop that evaluates predictions after 60 days.

## Architecture Diagram

```
Browser → Dashboard (:3000) → Express API (:3001)
                                    ↓
                Routes (data, live, dossier, campaigns, ai, predictions)
                                    ↓
                Service Layer (cache, redshift, ai, rules, gemini, campaign, drift)
                                    ↓
         ┌─────────┬──────────┬─────────┬──────────┬─────────────┬─────────────┐
    Redshift(prod) LocalPG   Mixpanel   S3       MoEngage    LLM Gateway
    (txns,data)  (predictions)         (audit)  (engage)    (Gemini/Haiku/
                                                             OpenRouter)
         └─────────┴──────────┴─────────┴──────────┴─────────────┴─────────────┘

Python ML Pipeline (offline):
  extract_signals.py → train_model.py → process_transactions.py → data/*.json
```

### Tiered Scoring Flow

```
User Score → determineTier() → T2 Rule Engine ($0, all users)
                              → T5 Gemini Flash (~$0.001, CRITICAL/HIGH)
                              → T6 Haiku (~$0.005, edge 0.38-0.42)
                              → OpenRouter fallback for T5/T6
```

## AI Usage (mandatory — this is 25% of your score)

| AI Tool / Model | Where in the app | What it does | Why AI over a non-AI approach |
|---|---|---|---|
| **Claude Haiku 4.5** (T6) | `POST /api/ai/risk-analysis` — edge cases (churn score 0.38-0.42) | Generates nuanced risk signals, intervention plans, and justifications for ambiguous users near the MEDIUM/LOW risk boundary | Rule-based scoring returns identical output for all edge cases; LLM captures contextual patterns in transaction + behavioral history that differentiate truly at-risk users from temporarily inactive ones |
| **Gemini 2.0 Flash** (T5) | `POST /api/ai/risk-analysis` — CRITICAL/HIGH users (score >= 0.60) | Enriches high-risk users with detailed risk signals, confidence-scored intervention recommendations, and urgency assessments | High-risk users warrant deeper analysis than static rules; LLM contextualizes why a user is churning (pricing vs. delivery vs. friction) to select the right intervention |
| **Claude Sonnet/Haiku** | `POST /api/ai/brief` | Generates 3-4 sentence retention briefs per user summarizing risk profile, behavioral patterns, and recommended actions | Free-text synthesis across 43 features, transaction history, and sentiment data cannot be templated — requires language understanding to produce actionable briefs |
| **Claude Sonnet/Haiku** | `POST /api/ai/chat` | Conversational churn intelligence — analysts ask questions about user risk, cohort patterns, and intervention strategies | Natural language Q&A over complex multi-dimensional data; pre-built queries can't anticipate every analytical question |
| **Ensemble ML** (LightGBM + XGBoost + CatBoost + LogReg meta) | Python pipeline → `data/*.json` → cached in Node.js | Predicts churn probability from 43 features; ensemble meta-learner combines 3 diverse base models for AUC 0.941 | 43 interacting features with non-linear relationships across 8 categories; hand-written rules cannot capture complex feature interactions like "kyc_completed_no_order + high_intent_no_completion" |
| **Rule Engine** (25 YAML rules) | `POST /api/ai/risk-analysis` — T2 tier (all users, $0) | Zero-cost deterministic baseline scoring using config-driven signal rules from `server/rules.yaml` | Provides 100% user coverage without API keys; also serves as the foundation for self-learning rule evolution where outcome data proposes rule weight adjustments |

## Features Claimed (Evaluator checks these)

Each claim is specific, testable, and mapped to a verification step in RUNBOOK.md.

- [x] **Claim 1:** Dashboard loads at `http://localhost:3000` and displays 10 functional tabs (Warroom, Explorer, Dossier, Playbooks, Model, Live, Campaigns, Simulator, Sentiment, Config)
- [x] **Claim 2:** API serves 52+ endpoints at `http://localhost:3001` with interactive Swagger UI at `/api-docs`
- [x] **Claim 3:** Healthcheck at `GET /healthz` returns `{ "status": "ok" }` with uptime
- [x] **Claim 4:** ML ensemble model (LightGBM + XGBoost + CatBoost + LogReg meta-learner) achieves AUC 0.941 on test data with 43 features across 8 categories
- [x] **Claim 5:** Rule engine (T2) evaluates 25 YAML-driven rules from `server/rules.yaml` at $0 cost for all users
- [x] **Claim 6:** Tiered LLM scoring auto-routes: T2 (all users) → T5 Gemini Flash (CRITICAL/HIGH, score >= 0.60) → T6 Haiku (edge cases 0.38-0.42), with OpenRouter fallback chain
- [x] **Claim 7:** `POST /api/ai/brief` generates AI-powered retention briefs using Claude, with rule-based fallback when API key is absent
- [x] **Claim 8:** `POST /api/ai/chat` provides conversational churn intelligence with platform context
- [x] **Claim 9:** MoEngage push notifications with 7-day cooldown protection, per-user spin-lock, and crash-safe cooldown rollback on MoEngage failure
- [x] **Claim 10:** Retell.ai voice calls with agent context passing (risk tier, churn probability, corridor, intervention type/message)
- [x] **Claim 11:** S3 audit trail stores timestamped JSON for every intervention (`campaigns/{date}/{uuid}.json`)
- [x] **Claim 12:** Self-learning feedback loop: predictions written to local PostgreSQL, evaluated after 60 days against actual Redshift transaction outcomes
- [x] **Claim 13:** Model drift detection alerts when AUC drops >5% for 2+ consecutive retrain runs
- [x] **Claim 14:** LLM cost tracking per tier — in-memory 24h rolling cache + persistent PostgreSQL 30-day aggregation
- [x] **Claim 15:** 136 tests pass (66 Python + 70 Node.js) with zero external service dependencies

## What we would build next (out of scope for this submission)

- **Real-time streaming ingestion** — replace 6-hour batch refresh with Kafka/Kinesis for sub-minute churn signal detection
- **A/B testing framework** — controlled experiments for intervention strategies (e.g., discount vs. callback for CRITICAL tier)
- **Multi-language AI briefs** — Hindi and Arabic support for corridor-specific retention communications
- **Auto-retraining pipeline** — canary deployment of retrained models (currently requires human approval per GR-009)

## Assumptions

- Evaluator has Node.js 18+ and Python 3.12+ installed
- For full AI features: evaluator provides their own `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY`
- Without any API keys, the app gracefully degrades to rule-based (T2) scoring at $0 — all endpoints remain functional
- Without Redshift access, live data tabs show cached/default data; core dashboard and AI features remain functional
- Without PostgreSQL, predictions and cooldowns operate in-memory only (no persistence)
- MoEngage and Retell.ai integrations return mock responses without valid API keys

## Limitations / Trade-offs

- **Data files (`data/`) are gitignored** — evaluator needs Redshift access or a seed CSV (`transactions_500k.csv`) to fully populate the dashboard. Without data, the dashboard loads but shows default/empty values
- **Graceful degradation mode** — without external service credentials (Redshift, Mixpanel, MoEngage, Retell), the app runs with mock/fallback responses throughout
- **Model artifacts not included** — `model.pkl` is generated by the training pipeline; pre-trained weights are not shipped in the repo
- **Chose cost efficiency over maximum accuracy** — tiered LLM routing means 95% of users get rule-based scoring ($0); LLM reserved for the top 5% where marginal accuracy justifies cost
- **Only tested with English-language inputs** — AI briefs and chat responses are in English only
- **Single-region deployment** — no multi-region or HA setup; designed for single-instance operation
