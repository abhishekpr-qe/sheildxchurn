# DECISIONS.md — ShieldXChurn

> Prior architectural decisions. Read before any task. Don't re-decide what's already decided.

---

## DEC-001: Clean Architecture with domain/infra/service layers (2025-01)
**Chose:** Four-layer structure: domain/ (pure logic), infra/ (adapters), service/ (orchestration), cli/ (presentation)
**Over:** Flat module structure, framework-coupled code
**Why:** Domain logic must be testable without Mixpanel/Redshift running — enables pure-function testing and future portability.
**Constraint:** NEVER import requests, redshift_connector, or any I/O library in domain/.

## DEC-002: Frozen dataclasses for all domain models (2025-01)
**Chose:** `@dataclass(frozen=True)` for ScreenEvent, Session, FunnelStep, FunnelResult, DropOff, FunnelConfig
**Over:** Mutable dataclasses, plain dicts, Pydantic models
**Why:** Immutability prevents accidental state mutation in pipeline processing; frozen enables hashing and equality by value.
**Constraint:** ALWAYS use frozen=True for domain models. NEVER mutate domain objects after construction.

## DEC-003: Order-preserving funnel analysis (2025-01)
**Chose:** Sequential step matching — user must visit steps in order (index-based forward search)
**Over:** Set-based matching (any order counts), timestamp-based matching
**Why:** Out-of-order screen visits (e.g., Dashboard before SignUp) produce false-positive funnel completions. Sequential matching reflects real user intent.
**Constraint:** NEVER count a funnel step as reached unless it appears AFTER the previous step in the event sequence.

## DEC-004: redshift_connector over psycopg2 (2025-01)
**Chose:** `redshift_connector` (official AWS library) for Redshift access
**Over:** psycopg2, SQLAlchemy, boto3 Data API
**Why:** Official AWS support, IAM auth capability, Redshift-specific optimizations. psycopg2 works but lacks IAM and native Redshift features.
**Constraint:** ALWAYS use redshift_connector for Redshift connections. NEVER introduce psycopg2 for Redshift.

## DEC-005: YAML + env var layered config (2025-01)
**Chose:** config.yaml for defaults, environment variables override at runtime
**Over:** Pure env vars, JSON config, TOML
**Why:** YAML is human-readable for funnel definitions; env vars enable deployment-time override without file changes. Precedence: ENV > YAML > defaults.
**Constraint:** NEVER hardcode connection strings or API keys. ALWAYS support env var override.

## DEC-006: Mixpanel as primary behavioral data source (2025-01)
**Chose:** Mixpanel Export API (events) + Engage API (user profiles) as primary data source
**Over:** Segment, Amplitude, custom event tracking
**Why:** Vance already uses Mixpanel for product analytics. Dual API provides both raw events (Export) and user-level aggregates (Engage).
**Constraint:** ALWAYS use Basic Auth with API secret for Mixpanel. NEVER store API secrets in code.

## DEC-007: Ensemble ML model (LightGBM + XGBoost + CatBoost + LogReg meta-learner) (2025-02)
**Chose:** Three diverse base learners with logistic regression meta-learner
**Over:** Single model (any one of the three), deep learning, simple heuristics
**Why:** Ensemble reduces overfitting and captures different data patterns. Meta-learner weights base predictions optimally.
**Constraint:** ALWAYS retrain all three base models together. NEVER deploy a single base model as the production scorer.

## DEC-008: 43-feature signal set from SIGNALS.md (2025-02)
**Chose:** 43 features across 8 categories (User Props, Engagement, Transactions, Funnel, Friction, Journey, Timing, Interactions)
**Over:** Raw event counts, fewer features, unstructured feature selection
**Why:** Comprehensive coverage of churn drivers documented in SIGNALS.md. Each feature has business justification and extraction logic.
**Constraint:** ALWAYS refer to SIGNALS.md as the feature specification. NEVER add features without documenting them there first.

## DEC-009: Dual backend — Python (analysis) + Node.js (API/dashboard) (2025-01)
**Chose:** Python for ML/analysis pipeline, Express.js for real-time API + dashboard serving
**Over:** Python-only (Flask/FastAPI), Node-only
**Why:** Python excels at data processing/ML. Node excels at real-time API serving with direct Redshift pool connections. Each plays to its strength.
**Constraint:** NEVER duplicate business logic between Python and Node. Python produces data artifacts (JSON), Node serves them.

## DEC-010: Risk tier discretization (CRITICAL/HIGH/MEDIUM/LOW) (2025-02)
**Chose:** Four risk tiers with fixed thresholds: CRITICAL ≥0.80, HIGH 0.60–0.79, MEDIUM 0.40–0.59, LOW <0.40
**Over:** Raw probability scores, three tiers, dynamic thresholds
**Why:** Discrete tiers enable targeted interventions with different cost/lift profiles per tier. Operations teams act on categories, not decimals.
**Constraint:** ALWAYS map scores to tiers for operational use. NEVER expose raw probabilities to non-technical stakeholders.

## DEC-013: Tiered LLM architecture — rule engine + Gemini Flash + Haiku (2026-02)
**Chose:** T2 rule engine (all users, $0) → T5 Gemini Flash (top 10K high-risk, ~$15/mo) → T6 Haiku (edge cases 0.38-0.42, ~$5/mo)
**Over:** Single-model LLM for all users ($2,250/mo at 5M), pure rule-based only
**Why:** 95% of users get identical quality from $0 rules. LLM reserved for high-risk bulk and ambiguous boundary scores where marginal accuracy matters.
**Constraint:** NEVER route all users through LLM. ALWAYS start with rule engine as baseline. Gemini has ENABLE_GEMINI kill switch.

## DEC-014: Self-learning feedback loop with 60-day outcome window (2026-02)
**Chose:** 60-day outcome validation, z-score drift detection (configurable 2-sigma), consecutive-run governance before alerting
**Over:** 30-day window (too short for remittance cadence), static model without feedback, auto-retrain on single drift event
**Why:** Remittance users transact monthly. 60 days matches churn definition. Consecutive-run governance prevents false alarms from single noisy runs.
**Constraint:** NEVER auto-deploy retrained models or threshold changes. ALWAYS require human approval. Drift alerts fire only after 2+ consecutive degraded runs.
