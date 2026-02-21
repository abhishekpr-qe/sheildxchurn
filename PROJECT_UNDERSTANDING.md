# Project Understanding — ShieldXChurn

## Problem Summary

Vance, an NRI remittance platform operating across UAE/UK/US→India corridors, has no proactive churn detection system. Users silently stop transacting, and the retention team discovers churn only after recovery becomes 5-10x more expensive. Manual CSV analysis from Redshift is the current workaround — slow, inconsistent, and unable to scale with the growing user base.

## Solution Summary

ShieldXChurn is a full-stack churn prediction and retention intelligence platform that combines:

1. **ML Pipeline (Python):** Extracts 43 behavioral features from Mixpanel, trains an ensemble model (LightGBM + XGBoost + CatBoost + LogReg meta-learner) achieving AUC 0.941 on test data, and produces scored user artifacts.

2. **API + Dashboard (Node.js):** Express API with 52+ endpoints serving a 10-tab SPA dashboard. Provides real-time data from Redshift, AI-powered risk analysis, user dossiers, campaign management, and a revenue simulator.

3. **Tiered LLM Scoring:** Cost-optimized AI architecture — T2 rule engine ($0 for all users), T5 Gemini Flash (~$0.001 for CRITICAL/HIGH), T6 Claude Haiku (~$0.005 for edge cases) — keeping monthly AI costs under $20 for the entire user base.

4. **Intervention Delivery:** MoEngage push notifications and Retell.ai voice calls with cooldown protection, crash-safe rollback, and S3 audit trails.

5. **Self-Learning Loop:** Predictions stored in PostgreSQL, evaluated after 60 days against actual Redshift transaction outcomes, with model drift detection and rule evolution proposals (human-approved).

## Assumptions

- The primary deployment target is a single-instance setup (no HA/multi-region)
- Vance already has Mixpanel, Redshift, and MoEngage integrations in production
- The 60-day churn definition matches the typical NRI remittance transaction cadence
- All external service integrations have graceful degradation (mock mode without API keys)
- Model retraining and rule changes require human approval (GR-009, GR-011)

## Open Questions

- **Seed data for evaluators:** The `data/` directory is gitignored. Evaluators without Redshift access will see an empty dashboard. Should a minimal anonymized dataset be included?
- **PostgreSQL requirement:** Several features (predictions, cost tracking, cooldowns) need PostgreSQL. Should there be a Docker Compose or setup script for quick PG provisioning?
- **Model artifacts:** The trained model (`model.pkl`) is not included in the repo. Should a pre-trained model be shipped for evaluation?
