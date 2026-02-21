# Problem Statement

## Context

Vance, an NRI (Non-Resident Indian) remittance platform operating across UAE, UK, and US corridors to India, has no proactive churn detection system. Users silently stop transacting with no early warning signals surfaced to the retention team. By the time churn is identified through manual CSV analysis, the recovery cost is 5-10x higher than prevention, and most users are already lost to competitors.

## Target Users

- **Retention/Growth team** at Vance — responsible for reducing churn rate and improving user lifetime value through targeted interventions
- **Product managers** — need data-driven insights on where users drop off in the funnel and which behavioral signals predict churn
- **Operations leads** — need to prioritize which at-risk users receive costly interventions (support callbacks, loyalty discounts, voice outreach)

## Pain Points

| Pain Point | Who feels it | Current workaround | Estimated impact |
|---|---|---|---|
| No churn prediction — users leave silently with no early warning | Retention team | Manual CSV exports from Redshift, eyeballing activity patterns weekly | 15-20% annual churn undetected until recovery window closes |
| No risk-based intervention prioritization — everyone gets the same campaign | Ops leads | Blanket push notifications to all users regardless of risk | ~70% wasted spend on low-risk users who would retain anyway |
| No behavioral signal extraction from Mixpanel at scale | Product managers | Manual Mixpanel queries, ad-hoc spreadsheet analysis | 2-3 hours per analysis cycle, inconsistent feature definitions across team |
| No AI-powered risk analysis for nuanced edge cases | Retention team | Generic static rule alerts with fixed thresholds | Misses contextual patterns — a user with 5 failed transfers needs different intervention than one who simply went inactive |
| No feedback loop — no way to know if predictions were right | Data team | No systematic tracking of prediction accuracy over time | Model degrades silently; no learning from intervention outcomes |

## Success Criteria

- Identifies at-risk users with AUC >= 0.90 on held-out test data (achieved: **0.941**)
- Routes interventions by risk tier: CRITICAL/HIGH get costly callbacks and discounts; MEDIUM gets email re-engagement; LOW is monitored only
- AI scoring costs < $20/month across entire user base via tiered LLM architecture (T2 rules at $0, T5 Gemini Flash ~$15/mo, T6 Haiku ~$5/mo)
- End-to-end visibility: prediction -> intervention -> outcome tracking with 60-day self-learning feedback loop
- Dashboard provides 10-tab operational view: from executive summary to individual user dossiers with AI-generated retention briefs

## Why Now

- **Data readiness:** Vance's Mixpanel (behavioral events) and Redshift (transaction history) integration now provides the 43-feature signal set needed for ML-grade churn prediction
- **AI cost inflection:** Claude Haiku and Gemini Flash APIs enable cost-effective risk analysis at $0.001-0.005/user — making AI-powered scoring feasible at scale with tiered routing
- **Competitive pressure:** NRI remittance space is increasingly competitive (Wise, Remitly, Instarem); retention is now a strategic differentiator, not a nice-to-have
- **Scale threshold:** User base has grown beyond what manual triage can handle — the retention team needs ML-powered prioritization to focus on users where intervention has the highest ROI
