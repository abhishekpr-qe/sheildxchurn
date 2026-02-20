# ShieldXChurn — Churn Prediction Signal Inventory

**Version:** 1.0
**Date:** 2026-02-20
**Data Source:** Mixpanel (Export API + Engage API)
**App:** Vance (Remittance — NRI money transfer)
**Mixpanel Project ID:** 2826019 (Production)
**Total Features:** 43

---

## 1. USER PROPERTY SIGNALS (Engage API) — 9 features

*Source: Mixpanel `/engage` endpoint — per-user profile properties. These are static or slowly-changing attributes stored on the user profile. Pulled once per user via pagination.*

### 1.1 Recency & Activity

| # | Feature | Source Property | Type | Extraction Logic | Why It Matters |
|---|---------|----------------|------|------------------|----------------|
| 1 | `days_since_last_seen` | `$last_seen` | int | `as_of_date - datetime($last_seen)`. Clipped to ≥0, capped at 999 for users with no recent activity. | **The #1 churn predictor.** Longer gap = higher churn probability. A user unseen for 30+ days is likely disengaging. Complements `days_since_last_event` (which uses export timestamps). |
| 2 | `total_app_sessions` | `$ae_total_app_sessions` | int | Direct integer value from profile. Defaults to 0 if missing. | Lifetime engagement depth. Users with <5 total sessions have very different behavior than users with 50+. Low session count + no orders = very high churn risk. |

### 1.2 Channel & Acquisition

| # | Feature | Source Property | Type | Extraction Logic | Why It Matters |
|---|---------|----------------|------|------------------|----------------|
| 3 | `push_enabled` | `push_notification` | binary | 1 if value is `"enabled"`, 0 otherwise (including missing). | Determines push channel eligibility for re-engagement. Users who disabled push are harder to reach AND signaled disinterest. A user who recently switched from enabled→disabled is a strong churn signal. |
| 4 | `is_referred` | `is_referred` | binary | 1 if value is `True` or `"true"`, 0 otherwise. | Referred users have different churn profiles — they may have been incentivized to install but had no real intent to send money. Helps segment organic vs acquired users. |

### 1.3 KYC Status

| # | Feature | Source Property | Type | Extraction Logic | Why It Matters |
|---|---------|----------------|------|------------------|----------------|
| 5 | `kyc_verified` | `user_kyc_status` | binary | 1 if `"VERIFIED"`, 0 otherwise. | Baseline gate — only verified users can transact. Also used as population filter for training. |
| 6 | `kyc_rejected` | `user_kyc_status` | binary | 1 if `"REJECTED"`, 0 otherwise. | **Involuntary churn.** User tried to verify but was rejected. They cannot transact — this is not a choice to leave, it's a blocker. Needs support-first intervention, not marketing. |
| 7 | `kyc_blocked` | `user_kyc_status` | binary | 1 if `"BLOCKED"`, 0 otherwise. | **Involuntary churn.** Account blocked by compliance. User physically cannot use the app. Different intervention needed (compliance resolution, not offers). |
| 8 | `kyc_re_required` | `user_kyc_status` | binary | 1 if `"RE_KYC_REQUIRED"`, 0 otherwise. | **Friction churn.** User was verified before but now needs to redo KYC (regulatory change, expired documents). Many users won't bother — high drop-off risk. |
| 9 | `kyc_pending` | `user_kyc_status` | binary | 1 if `"PENDING"`, 0 otherwise. | **Stuck in limbo.** User submitted KYC but hasn't been approved. Long pending times cause abandonment. If `days_since_last_seen` is growing while KYC is pending, user is likely gone. |

---

## 2. ENGAGEMENT SIGNALS (Event Aggregation) — 7 features

*Source: Aggregated from `home_screen_loaded`, `$ae_session`, and `Screen loaded` events. These measure how actively the user interacts with the app over time windows.*

### 2.1 App Open Frequency

| # | Feature | Event | Window | Extraction Logic | Why It Matters |
|---|---------|-------|--------|------------------|----------------|
| 10 | `app_opens_l30` | `home_screen_loaded` | Last 30 days | COUNT of `home_screen_loaded` events where `timestamp >= as_of_date - 30d`. | Recent engagement intensity. Users who opened the app 0 times in 30 days are likely churned. Users who opened 10+ times but never transacted are "browsing" — different churn driver. |
| 11 | `app_opens_prior30` | `home_screen_loaded` | 30–60 days ago | COUNT of `home_screen_loaded` events where `timestamp` is between `as_of_date - 60d` and `as_of_date - 30d`. | Historical baseline for comparison. Needed to compute `session_freq_ratio`. If prior period was high and current is low, user is disengaging. |
| 12 | `session_freq_ratio` | Computed | Trend | `app_opens_l30 / (app_opens_prior30 + 0.01)`. The 0.01 smoothing prevents division by zero. | **Engagement velocity.** Ratio < 1.0 means declining engagement. Ratio < 0.3 means engagement dropped >70% — strong churn signal. Ratio > 1.0 means growing engagement — healthy. This captures the *trend*, not just the level. |

### 2.2 Session Depth & Exploration

| # | Feature | Event | Window | Extraction Logic | Why It Matters |
|---|---------|-------|--------|------------------|----------------|
| 13 | `unique_screens_visited` | `Screen loaded` | All time | COUNT DISTINCT of `screen_name` property across all `Screen loaded` events for this user. | Measures how much of the app the user explored. Users who only visited 2–3 screens (e.g., splash + onboarding) never discovered the product. Users with 15+ unique screens are deep explorers. |
| 14 | `screen_depth_avg` | `Screen loaded` / `$ae_session` | All time | `total_screen_loaded_events / total_ae_session_events`. If 0 sessions, default to 0. | Average screens viewed per session. Shallow sessions (1–2 screens) indicate bouncing. Deep sessions (8+ screens) indicate engagement. Combined with `app_opens`, distinguishes "opens often but does nothing" from "opens less but engages deeply". |

### 2.3 Recency & Cadence

| # | Feature | Event | Window | Extraction Logic | Why It Matters |
|---|---------|-------|--------|------------------|----------------|
| 15 | `days_since_last_event` | Any event | Recency | `as_of_date - max(timestamp)` across ALL events for this user. Defaults to 999 if no events. | Complements `days_since_last_seen` (engage property). Export-derived recency may differ from engage-derived recency due to event processing delays. Using both gives a more robust recency signal. |
| 16 | `avg_session_gap_days` | `$ae_session` | All time | Sort `$ae_session` events by timestamp, compute mean of `(timestamp[i+1] - timestamp[i])` in days. If <2 sessions, default to `days_since_first_event`. | Session cadence. Daily users (gap ~1d) are very different from weekly users (gap ~7d). Increasing gaps over time signal fading engagement. Combined with `session_freq_ratio`, captures both level and trend. |

---

## 3. TRANSACTION SIGNALS (Event Aggregation) — 9 features

*Source: Aggregated from `ORDER_CREATED`, `ORDER_COMPLETED`, and `send now click` events. These are the strongest predictors of actual churn because they directly measure the core action: sending money.*

### 3.1 Transaction Volume

| # | Feature | Event | Window | Extraction Logic | Why It Matters |
|---|---------|-------|--------|------------------|----------------|
| 17 | `order_created_l30` | `ORDER_CREATED` | Last 30 days | COUNT of `ORDER_CREATED` events in last 30 days. | Recent transaction activity. 0 orders in 30 days for a previously active user = at-risk. Combined with `order_created_l90`, captures velocity change. |
| 18 | `order_created_l90` | `ORDER_CREATED` | Last 90 days | COUNT of `ORDER_CREATED` events in last 90 days. | Longer-window baseline. Captures quarterly patterns (seasonal senders may have 0 in L30 but 3 in L90). |
| 19 | `order_completed_l30` | `ORDER_COMPLETED` | Last 30 days | COUNT of `ORDER_COMPLETED` events in last 30 days. If event doesn't exist in export, fall back to `order_created_l30`. | Distinguishes initiated vs completed orders. If `order_created > order_completed`, user is experiencing failures in the transfer flow. |
| 20 | `total_orders` | `ORDER_CREATED` | All time | Lifetime COUNT of `ORDER_CREATED` events. | Lifetime value indicator. Users with 1 order have very different profiles than users with 20+. Also used for `is_one_and_done` computation and population filtering (minimum 1 order for training). |
| 21 | `days_since_last_order` | `ORDER_CREATED` | Recency | `as_of_date - max(ORDER_CREATED timestamp)` in days. If no orders, set to 999. | **Core churn signal.** Directly defines churn segments: ≤30d = healthy, 30–60d = at-risk, >60d = churned. Most important input to the label definition. |

### 3.2 Transaction Velocity & Intent

| # | Feature | Event | Window | Extraction Logic | Why It Matters |
|---|---------|-------|--------|------------------|----------------|
| 22 | `tx_frequency_ratio` | Computed | Trend | `order_created_l30 / (order_created_l90 / 3 + 0.01)`. Normalizes L90 to monthly equivalent, adds smoothing. | **Transaction velocity change.** Ratio < 1.0 = declining, < 0.3 = collapsed. A user who sent 3x/month for 90 days but 0 in the last 30 is rapidly churning. More actionable than raw counts because it captures the *trajectory*. |
| 23 | `send_clicks_l30` | `send now click` | Last 30 days | COUNT of `send now click` events in last 30 days. | Measures transaction *intent* vs actual completion. High send clicks + low orders = something is blocking the user (price, error, UX). Zero send clicks = no intent at all (different churn type). |
| 24 | `tx_conversion_rate` | Computed | Last 30d | `order_created_l30 / (send_clicks_l30 + 0.01)`. Smoothed to avoid division by zero. | Funnel conversion efficiency. Rate ~1.0 = every attempt succeeds. Rate ~0.2 = 80% of attempts fail or are abandoned. Low conversion + high intent = fixable churn (UX issue, pricing). Low conversion + low intent = gone. |
| 25 | `started_never_completed` | Computed | All time | Binary: 1 if `send_clicks > 0 AND total_orders == 0`, else 0. Where `send_clicks` = lifetime count of `send now click`. | **High-intent never-converted.** User tried to send money at least once but never completed a transfer. Very actionable — they wanted to use the product but something stopped them. Likely fixable with support or incentive. |

---

## 4. TRANSFER FUNNEL SIGNALS (Event Aggregation) — 3 features

*Source: `transfer_screen_loaded` and `review_transfer_screen_loaded` events. These track how far users get in the send-money flow: Intent → Review → Complete.*

| # | Feature | Event | Window | Extraction Logic | Why It Matters |
|---|---------|-------|--------|------------------|----------------|
| 26 | `transfer_intent_l30` | `transfer_screen_loaded` | Last 30d | COUNT of `transfer_screen_loaded` events in last 30 days. | Transfer funnel entry. Users who load the transfer screen are showing intent to send money. If this is >0 but `order_created_l30` is 0, they entered the funnel but didn't complete — valuable for understanding where they dropped off. |
| 27 | `funnel_reach_l30` | `review_transfer_screen_loaded` | Last 30d | COUNT of `review_transfer_screen_loaded` events in last 30 days. | Transfer funnel progression. The review screen is the last step before payment — reaching here means the user chose a recipient, entered an amount, and saw the fees/rate. If they drop at review, it's likely a pricing or fee concern. |
| 28 | `browsing_ratio` | Computed | Last 30d | `app_opens_l30 / (transfer_intent_l30 + 0.01)`. Smoothed denominator. | **Browsing without transacting.** High ratio (e.g., 10+ opens per transfer attempt) = user opens the app but rarely starts a transfer. Could be checking rates, exploring, or lacking confidence. Low ratio (~1–2) = every app open leads to a transfer attempt — healthy engaged user. |

---

## 5. FRICTION / FRUSTRATION SIGNALS (Event Aggregation) — 4 features

*Source: `bifrost api failed`, `bifrost api timeout exception`, `help_and_support_screen_loaded`, `chat_with_us_clicked`. These capture negative experiences that drive users away.*

| # | Feature | Event | Window | Extraction Logic | Why It Matters |
|---|---------|-------|--------|------------------|----------------|
| 29 | `api_errors_l30` | `bifrost api failed` | Last 30d | COUNT of `bifrost api failed` events in last 30 days. | Direct measure of technical failures experienced. Users who hit API errors during transfers lose trust. 2+ failures often lead to abandonment. Critical to distinguish voluntary churn (disinterested) from frustrated churn (wanted to use but couldn't). |
| 30 | `api_timeouts_l30` | `bifrost api timeout exception` | Last 30d | COUNT of `bifrost api timeout exception` events in last 30 days. | Timeouts during payment are especially damaging — user doesn't know if money was sent or not. Creates anxiety and distrust. Even 1 timeout during a first transfer can permanently lose a user. |
| 31 | `error_rate` | Computed | Last 30d | `(api_errors_l30 + api_timeouts_l30) / (total_app_sessions + 0.01)`. Uses total sessions as denominator for normalization. | **Normalized frustration score.** A user with 2 errors in 2 sessions (100% error rate) is more frustrated than a user with 2 errors in 50 sessions (4% error rate). Controls for activity level when measuring friction impact. |
| 32 | `help_opens_l30` | `help_and_support_screen_loaded` + `chat_with_us_clicked` | Last 30d | SUM of both event counts in last 30 days. | **Help-seeking signal.** Users who open help or start support chat are experiencing friction. If they seek help AND subsequently churn, the support experience didn't resolve their issue. Combined with `api_errors`, distinguishes technical friction from confusion/UX friction. |

---

## 6. SCREEN JOURNEY SIGNALS (Screen loaded events) — 3 features

*Source: `Screen loaded` event with `screen_name` property. These capture how far the user progressed through onboarding and KYC — the two critical activation gates.*

| # | Feature | Logic | Type | Why It Matters |
|---|---------|-------|------|----------------|
| 33 | `onboarding_step_reached` | Map each user's `Screen loaded` events to the onboarding screen order below. Return the highest ordinal reached. Default 0 if no onboarding screens visited. | int (0–5) | Captures exactly where in onboarding the user stopped. Ordinal 1–2 = barely started. Ordinal 3–4 = tried but gave up at phone/OTP. Ordinal 5 = completed. Enables targeting: OTP-droppers get SMS reminders, splash-bouncers get push notifications. |
| 34 | `kyc_completed` | Binary: 1 if user has both any `KYC_*` or `UAE_KYC_*` screen_name AND subsequently visited `home-screen` (timestamp after KYC screen). 0 otherwise. | binary | KYC is the biggest activation gate in remittance. Users who complete KYC are 5–10x more likely to transact. Users stuck in KYC = involuntary non-transactors. |
| 35 | `onboarding_completed` | Binary: 1 if user visited `home-screen` after any `onboarding_*` screen_name (timestamp after onboarding screen). 0 otherwise. | binary | Similar to `kyc_completed` but broader — covers the entire signup → home journey. Users who never reached home screen had zero chance of discovering the core product. |

**Onboarding screen order (for `onboarding_step_reached` ordinal encoding):**

| Ordinal | Screen Name | Stage |
|---------|-------------|-------|
| 0 | *(never started)* | No onboarding screens seen |
| 1 | `onboarding_splash-screen` | Saw the app intro |
| 2 | `onboarding_carousel-screen` | Swiped through value propositions |
| 3 | `onboarding_enter-mobile-number` | Started signup (entered phone) |
| 4 | `onboarding_enter-verification-code` | Received OTP, entering code |
| 5 | `home-screen` | Completed onboarding, landed on home |

---

## 7. TIMING SIGNALS (Computed from timestamps) — 4 features

*Source: Computed from event timestamps across multiple event types. These capture temporal patterns — when users do things and how regular they are.*

| # | Feature | Logic | Type | Why It Matters |
|---|---------|-------|------|----------------|
| 36 | `days_since_first_event` | `as_of_date - min(timestamp)` across all events for this user. | int | **Account age proxy.** Used as a minimum threshold for training (≥30 days). New users (<7 days) have incomplete feature windows — predictions are unreliable. Also distinguishes "new user exploring" from "old user disengaging" — same low activity, very different meaning. |
| 37 | `days_to_first_order` | `min(ORDER_CREATED timestamp) - min(any event timestamp)` in days. Set to -1 if user has 0 orders. | int | **Activation speed.** Users who send money within 3 days of installing are much stickier than users who take 30+ days. Fast activators internalize the product value quickly. Slow activators may have been comparing alternatives. -1 value = never activated (useful for segmentation). |
| 38 | `tx_regularity_score` | Standard deviation of days between consecutive `ORDER_CREATED` events. If <2 orders, default to -1 (insufficient data). Lower values = more regular. | float | **Cadence consistency.** Regular monthly senders (std ~2–5 days) are salary-cycle users — very sticky, unlikely to churn. Irregular senders (std ~30+ days) are opportunistic — they come and go. Prevents false-positive churn predictions on seasonal/salary-cycle senders who look inactive between sends. |
| 39 | `is_one_and_done` | Binary: 1 if `total_orders == 1 AND days_since_first_event > 90`, else 0. | binary | **One-time sender flag.** Users who sent money exactly once, over 90 days ago, likely had a single purpose (one-time payment to family). They're not "churning" — they completed their goal. Treating them as churned wastes intervention budget. This flag lets the model separate them from recurring users who stopped. |

---

## 8. FEATURE INTERACTION SIGNALS (Computed combinations) — 4 features

*Source: Computed from combinations of other features. XGBoost can learn interactions automatically, but explicit encoding improves SHAP interpretability — instead of "feature X is important", you get "user completed KYC but never ordered" as a clear, actionable insight.*

| # | Feature | Logic | Type | Why It Matters |
|---|---------|-------|------|----------------|
| 40 | `kyc_completed_no_order` | Binary: 1 if `kyc_completed == 1 AND total_orders == 0`, else 0. | binary | **Activated but never converted.** User completed the hardest step (KYC verification) but never sent money. These are high-value targets — they've already invested effort. Likely blocked by pricing, confidence, or UX friction. Best response: first-transfer incentive or guided walkthrough. |
| 41 | `errors_before_first_order` | Binary: 1 if `(api_errors_l30 + api_timeouts_l30) > 0 AND total_orders == 0`, else 0. | binary | **Friction killed first conversion.** User never completed a transfer AND experienced API errors. Technical issues during the critical first attempt are devastating — user has no positive experience to fall back on. Needs support-first intervention: acknowledge the issue, offer to help complete the transfer. |
| 42 | `high_intent_no_completion` | Binary: 1 if `send_clicks_l30 > 2 AND order_created_l30 == 0`, else 0. | binary | **Repeated failed attempts.** User clicked "send" more than twice in 30 days but completed zero orders. They're actively trying and failing. Root causes: payment method issues, rate dissatisfaction at review screen, recipient validation errors, amount limits. Very actionable — fix the blocker and they'll convert. |
| 43 | `single_session_deep_funnel` | Binary: 1 if `total_app_sessions <= 2 AND funnel_reach_l30 > 0`, else 0. | binary | **Price comparison bouncer.** User came once or twice, went deep into the transfer funnel (reached review screen where fees/rates are shown), but never returned. Classic rate-shopping behavior — they were comparing Vance against competitors. Re-engage with rate alerts or fee promotions when rates improve. |

---

## 9. EVENTS REQUIRED FROM MIXPANEL EXPORT API

*These events must be exported for the feature date range. Export via `/api/2.0/export` endpoint with streaming JSONL parsing.*

| Event Name | Properties Used | Feature(s) Derived |
|---|---|---|
| `Screen loaded` | `screen_name`, `distinct_id`, `time` | `unique_screens_visited`, `screen_depth_avg`, `onboarding_step_reached`, `kyc_completed`, `onboarding_completed` |
| `ORDER_CREATED` | `distinct_id`, `time` | `order_created_l30/l90`, `total_orders`, `days_since_last_order`, `tx_frequency_ratio`, `tx_regularity_score`, `days_to_first_order`, `is_one_and_done` + **churn label** |
| `ORDER_COMPLETED` | `distinct_id`, `time` | `order_completed_l30` |
| `send now click` | `distinct_id`, `time` | `send_clicks_l30`, `tx_conversion_rate`, `started_never_completed` |
| `bifrost api failed` | `distinct_id`, `time` | `api_errors_l30`, `error_rate`, `errors_before_first_order` |
| `bifrost api timeout exception` | `distinct_id`, `time` | `api_timeouts_l30`, `error_rate`, `errors_before_first_order` |
| `home_screen_loaded` | `distinct_id`, `time` | `app_opens_l30`, `app_opens_prior30`, `session_freq_ratio`, `browsing_ratio` |
| `transfer_screen_loaded` | `distinct_id`, `time` | `transfer_intent_l30`, `browsing_ratio` |
| `review_transfer_screen_loaded` | `distinct_id`, `time` | `funnel_reach_l30`, `single_session_deep_funnel` |
| `help_and_support_screen_loaded` | `distinct_id`, `time` | `help_opens_l30` |
| `chat_with_us_clicked` | `distinct_id`, `time` | `help_opens_l30` |
| `$ae_session` | `distinct_id`, `time` | `screen_depth_avg`, `avg_session_gap_days` |

---

## 10. ENGAGE PROPERTIES REQUIRED

*Pulled from Mixpanel `/engage` endpoint. Paginated, returns per-user profiles.*

| Property | Type | Feature(s) Derived |
|---|---|---|
| `$last_seen` | datetime | `days_since_last_seen` |
| `$ae_total_app_sessions` | int | `total_app_sessions` |
| `push_notification` | string | `push_enabled` |
| `is_referred` | boolean | `is_referred` |
| `user_kyc_status` | string | `kyc_verified`, `kyc_rejected`, `kyc_blocked`, `kyc_re_required`, `kyc_pending` |

---

## 11. CHURN LABEL DEFINITION

### Segmentation Rules

| Segment | Rule | Description |
|---|---|---|
| **Healthy** | `days_since_last_order` ≤ 30 | Active transacting user |
| **At-Risk** | `days_since_last_order` 31–60 | Showing signs of disengagement |
| **Churned** | `days_since_last_order` > 60 | Stopped transacting |

### Training Label

- **Label = 0 (Retained):** User completed ≥1 `ORDER_CREATED` event in the 60-day forward window from observation date
- **Label = 1 (Churned):** User completed 0 `ORDER_CREATED` events in the 60-day forward window

### Population Filters (Training Set)

| Filter | Why |
|---|---|
| `kyc_verified == 1` | Only users who CAN transact |
| `total_orders >= 1` | Has transacted at least once (not activation churn) |
| `days_since_first_event >= 30` | Not cold-start — enough data for feature windows |

---

## 12. SUMMARY

| Category | Count | Features |
|---|---|---|
| User Properties (Engage) | 9 | days_since_last_seen, total_app_sessions, push_enabled, is_referred, kyc_verified, kyc_rejected, kyc_blocked, kyc_re_required, kyc_pending |
| Engagement | 7 | app_opens_l30, app_opens_prior30, session_freq_ratio, unique_screens_visited, screen_depth_avg, days_since_last_event, avg_session_gap_days |
| Transaction | 9 | order_created_l30, order_created_l90, order_completed_l30, total_orders, days_since_last_order, tx_frequency_ratio, send_clicks_l30, tx_conversion_rate, started_never_completed |
| Transfer Funnel | 3 | transfer_intent_l30, funnel_reach_l30, browsing_ratio |
| Friction / Frustration | 4 | api_errors_l30, api_timeouts_l30, error_rate, help_opens_l30 |
| Screen Journey | 3 | onboarding_step_reached, kyc_completed, onboarding_completed |
| Timing | 4 | days_since_first_event, days_to_first_order, tx_regularity_score, is_one_and_done |
| Feature Interactions | 4 | kyc_completed_no_order, errors_before_first_order, high_intent_no_completion, single_session_deep_funnel |
| **TOTAL** | **43** | |

---

## 13. ADD YOUR SIGNALS BELOW

<!-- Add additional signals here. Format:
| # | Feature Name | Source | Type | Logic | Why It Matters |
|---|---|---|---|---|---|
| 44 | your_feature | event/property | type | how to compute | why it predicts churn |
-->
