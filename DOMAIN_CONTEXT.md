# Domain Context

> **When to load this file:** Only when working on domain-specific tasks (churn prediction, remittance operations, Mixpanel analytics). Do not load for general engineering work.
>
> **Last updated:** 2026-02-21

---

## Industry

Fintech / Cross-border remittance. NRI (Non-Resident Indian) money transfer. Multi-region corridors: UAE, UK, US, EU → India. Product: Vance.

## Core Domains

| Domain | Key Entities | Operations |
|--------|-------------|------------|
| **Churn Prediction** | Users, sessions, funnels, risk tiers, features | Signal extraction, model training, scoring, intervention |
| **Transfer Operations** | Orders, transactions, corridors, statuses | SLA tracking, completion monitoring, stuck detection |
| **User Analytics** | Screen events, sessions, drop-offs, engagement | Funnel analysis, session building, last-screen detection |
| **ML Pipeline** | Features, models, ensembles, predictions | Extraction, training, retraining, drift detection, calibration |

## Terminology

| Term | Meaning |
|------|---------|
| Churn | User who hasn't transacted in 60+ days (forward-looking label) |
| Soft Churn | Reduced activity but not fully churned |
| Risk Tier | Discretized churn probability: CRITICAL (≥0.80), HIGH (0.60–0.79), MEDIUM (0.40–0.59), LOW (<0.40) |
| Corridor | Currency/geography transfer route (e.g., AED→India = UAE→India) |
| NRI | Non-Resident Indian — primary user segment |
| Funnel | Ordered sequence of screens a user must visit (e.g., Home → SignUp → Dashboard) |
| Drop-off | Point where a user exits the funnel or session |
| Last Screen | Final screen visited in a session — indicates where engagement ended |
| Engage API | Mixpanel API for user profile data (properties, aggregates) |
| Export API | Mixpanel API for raw event stream (JSONL format) |
| Session | Grouped events by distinct_id, sorted chronologically |
| L30 / L90 | Last 30 / 90 days rolling window for feature computation |
| Prior30 | 30-day window before L30 — used for velocity/trend ratios |
| Feature Interaction | Cross-feature combinations (e.g., kyc_completed_no_order, high_intent_no_completion) |
| Ensemble | Multiple ML models (LightGBM + XGBoost + CatBoost) combined via meta-learner |
| Meta-learner | Logistic regression trained on base model predictions |
| Drift Detection | Monitoring if feature distributions shift beyond 2-sigma thresholds |
| Calibration | Verifying predicted probabilities match actual churn rates |

## Data Architecture

| System | Purpose | Access Pattern |
|--------|---------|---------------|
| Mixpanel (Export API) | Raw event stream — screen views, actions | JSONL streaming, Basic Auth |
| Mixpanel (Engage API) | User profiles — properties, aggregates | Paginated JSON, session_id |
| Redshift | Transaction history, order data, delivery metrics | SQL via redshift_connector |
| S3 | Data artifact storage (CSVs, model files) | AWS SDK |
| Local JSON | Dashboard data (churn_dashboard_data.json, real_transactions.json) | File I/O |

## Key Tables (Redshift)

| Table | Purpose |
|-------|---------|
| `analytics_orders_master_data` | All transactions — user_id, send_amount, currency_from, og_status, timestamps |
| `falcon_transactions_v2` | Falcon-level transaction details |
| `rda_fulfillments` | Fulfillment tracking |
| `partner_fulfillments` | Partner-side fulfillment details |
| `user_pricing_whitelist` | Pricing cohort assignments |

## Transaction Status Values

| Status | Meaning |
|--------|---------|
| COMPLETED | Successful transaction |
| FAILED | Explicit failure |
| PENDING / NEW / CREATED / PROCESSING_DEAL_IN | In-flight |
| STUCK | Stalled (>24 hours without progress) |

## Corridor Mapping

| Currency | Route |
|----------|-------|
| AED | UAE → India |
| GBP | UK → India |
| USD | USA → India |
| EUR | Europe → India |

## 43-Feature Signal Categories

| Category | Count | Key Features |
|----------|-------|-------------|
| User Properties | 9 | days_since_last_seen, total_app_sessions, push_enabled, kyc_* |
| Engagement | 7 | app_opens_l30, session_freq_ratio, days_since_last_event |
| Transactions | 9 | order_created_l30, tx_frequency_ratio, started_never_completed |
| Transfer Funnel | 3 | transfer_intent_l30, funnel_reach_l30, browsing_ratio |
| Friction | 4 | api_errors_l30, error_rate, help_opens_l30 |
| Screen Journey | 3 | onboarding_step_reached, kyc_completed, onboarding_completed |
| Timing | 4 | days_since_first_event, tx_regularity_score, is_one_and_done |
| Interactions | 4 | kyc_completed_no_order, high_intent_no_completion |

Full specification: see `SIGNALS.md` in project root.
