/**
 * Aspora Churn Intelligence — Production SQL Queries (Redshift)
 * Auto-refreshing every 6 hours via Metabase API
 *
 * Tables:
 *   analytics_orders_master_data (AOMD) — transactions
 *   falcon_transactions_v2 (FTV2) — falcon-level txns
 *   rda_fulfillments — fulfillment tracking
 *   partner_fulfillments — partner-side details
 *   user_pricing_whitelist — pricing cohort assignments
 *   churn_predictions — model prediction history (created by DDL below)
 */

// Q1: Core Transaction Data — last 12 months, all transactions
const QUERY_TRANSACTIONS = `
SELECT
    user_id,
    send_amount,
    currency_from,
    og_status,
    created_at,
    updated_at,
    DATEDIFF(minute, created_at, updated_at) AS processing_minutes
FROM analytics_orders_master_data
WHERE created_at >= DATEADD(month, -12, GETDATE())
  AND user_id IS NOT NULL
  AND send_amount > 0
ORDER BY created_at DESC;
`;

// Q2: Per-User Delivery Metrics — rolling 12 months
const QUERY_DELIVERY = `
SELECT
    user_id,
    COUNT(*) AS total_orders,
    SUM(CASE WHEN og_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN og_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN og_status IN ('STUCK', 'PROCESSING', 'PENDING')
         AND DATEDIFF(hour, created_at, GETDATE()) > 24 THEN 1 ELSE 0 END) AS stuck,
    SUM(CASE WHEN og_status = 'COMPLETED'
         AND DATEDIFF(minute, created_at, updated_at) <= 10 THEN 1 ELSE 0 END) AS delivered_under_10min,
    SUM(CASE WHEN og_status = 'COMPLETED'
         AND DATEDIFF(minute, created_at, updated_at) > 10
         AND DATEDIFF(minute, created_at, updated_at) <= 60 THEN 1 ELSE 0 END) AS delivered_10_to_60min,
    SUM(CASE WHEN og_status = 'COMPLETED'
         AND DATEDIFF(minute, created_at, updated_at) > 60 THEN 1 ELSE 0 END) AS delivered_over_1hr,
    ROUND(AVG(CASE WHEN og_status = 'COMPLETED'
              THEN DATEDIFF(minute, created_at, updated_at) END), 2) AS avg_delivery_minutes
FROM analytics_orders_master_data
WHERE created_at >= DATEADD(month, -12, GETDATE())
  AND user_id IS NOT NULL
  AND send_amount > 0
GROUP BY user_id;
`;

// Q3: Pricing Cohort Assignments
const QUERY_PRICING = `
SELECT
    userid AS user_id,
    whitelisttype AS pricing_cohort
FROM user_pricing_whitelist
WHERE whitelisttype IS NOT NULL
  AND whitelisttype != '';
`;

// Q4: Real-Time Early Warning Signals
const QUERY_EARLY_WARNINGS = `
WITH user_activity AS (
    SELECT
        user_id,
        currency_from,
        COUNT(*) AS total_txns,
        SUM(CASE WHEN og_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN og_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
        SUM(send_amount) AS total_volume,
        MIN(created_at) AS first_txn,
        MAX(created_at) AS last_txn,
        DATEDIFF(day, MAX(created_at), GETDATE()) AS days_since_last,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS txns_last_30d,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE()) THEN send_amount ELSE 0 END) AS vol_last_30d,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE()) AND og_status = 'FAILED' THEN 1 ELSE 0 END) AS fails_last_30d,
        SUM(CASE WHEN created_at >= DATEADD(day, -60, GETDATE())
                  AND created_at < DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS txns_30_60d,
        SUM(CASE WHEN created_at >= DATEADD(day, -60, GETDATE())
                  AND created_at < DATEADD(day, -30, GETDATE()) THEN send_amount ELSE 0 END) AS vol_30_60d,
        SUM(CASE WHEN created_at >= DATEADD(day, -90, GETDATE())
                  AND created_at < DATEADD(day, -60, GETDATE()) THEN 1 ELSE 0 END) AS txns_60_90d,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE())
                  AND og_status = 'COMPLETED'
                  AND DATEDIFF(minute, created_at, updated_at) > 60 THEN 1 ELSE 0 END) AS slow_deliveries_30d,
        SUM(CASE WHEN og_status IN ('STUCK', 'PROCESSING', 'PENDING')
                  AND DATEDIFF(hour, created_at, GETDATE()) > 24 THEN 1 ELSE 0 END) AS currently_stuck
    FROM analytics_orders_master_data
    WHERE created_at >= DATEADD(month, -12, GETDATE())
      AND user_id IS NOT NULL
      AND send_amount > 0
    GROUP BY user_id, currency_from
),
risk_signals AS (
    SELECT *,
        CASE WHEN txns_30_60d > 0 AND txns_last_30d = 0 THEN 1 ELSE 0 END AS signal_frequency_drop,
        CASE WHEN vol_30_60d > 0 AND vol_last_30d < vol_30_60d * 0.5 THEN 1 ELSE 0 END AS signal_volume_drop,
        CASE WHEN txns_last_30d > 0 AND (fails_last_30d * 1.0 / NULLIF(txns_last_30d, 0)) > 0.2 THEN 1 ELSE 0 END AS signal_high_failures,
        CASE WHEN txns_30_60d >= 2 AND txns_last_30d = 0 THEN 1 ELSE 0 END AS signal_going_inactive,
        CASE WHEN slow_deliveries_30d >= 2 THEN 1 ELSE 0 END AS signal_slow_delivery,
        CASE WHEN currently_stuck > 0 THEN 1 ELSE 0 END AS signal_stuck_now,
        DATEDIFF(day, first_txn, GETDATE()) AS tenure_days,
        CASE currency_from
            WHEN 'AED' THEN 'UAE'
            WHEN 'GBP' THEN 'UK'
            WHEN 'USD' THEN 'US'
            ELSE 'Other'
        END AS corridor
    FROM user_activity
    WHERE total_txns >= 2
)
SELECT
    user_id, corridor, currency_from, tenure_days, days_since_last,
    total_txns, completed, failed, total_volume,
    txns_last_30d, txns_30_60d, txns_60_90d,
    vol_last_30d, vol_30_60d, fails_last_30d,
    slow_deliveries_30d, currently_stuck,
    signal_frequency_drop, signal_volume_drop, signal_high_failures,
    signal_going_inactive, signal_slow_delivery, signal_stuck_now,
    (signal_frequency_drop + signal_volume_drop + signal_high_failures +
     signal_going_inactive + signal_slow_delivery + signal_stuck_now) AS total_risk_signals,
    GETDATE() AS scored_at
FROM risk_signals
WHERE (signal_frequency_drop + signal_volume_drop + signal_high_failures +
       signal_going_inactive + signal_slow_delivery + signal_stuck_now) >= 1
ORDER BY RANDOM()
LIMIT 5000;
`;

// Q5: Corridor Health Dashboard (optimized — no correlated subquery)
const QUERY_CORRIDOR_HEALTH = `
WITH user_corridor AS (
    SELECT
        user_id, currency_from,
        MAX(created_at) AS last_txn,
        COUNT(*) AS total_txns,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE()) THEN send_amount ELSE 0 END) AS vol_30d,
        SUM(CASE WHEN created_at >= DATEADD(day, -60, GETDATE())
                  AND created_at < DATEADD(day, -30, GETDATE()) THEN send_amount ELSE 0 END) AS vol_30_60d,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE()) AND og_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_30d,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS txns_30d,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE()) AND og_status = 'COMPLETED'
              THEN DATEDIFF(minute, created_at, updated_at) ELSE NULL END) AS delivery_min_sum_30d,
        SUM(CASE WHEN created_at >= DATEADD(day, -30, GETDATE()) AND og_status = 'COMPLETED' THEN 1 ELSE 0 END) AS delivery_count_30d,
        SUM(CASE WHEN og_status IN ('STUCK','PROCESSING','PENDING')
                  AND DATEDIFF(hour, created_at, GETDATE()) > 24 THEN 1 ELSE 0 END) AS stuck_count
    FROM analytics_orders_master_data
    WHERE created_at >= DATEADD(month, -12, GETDATE())
      AND user_id IS NOT NULL
    GROUP BY user_id, currency_from
)
SELECT
    CASE currency_from
        WHEN 'AED' THEN 'UAE → India'
        WHEN 'GBP' THEN 'UK → India'
        WHEN 'USD' THEN 'US → India'
        ELSE 'Other'
    END AS corridor,
    COUNT(*) AS total_users,
    SUM(CASE WHEN last_txn >= DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS active_30d,
    SUM(CASE WHEN last_txn >= DATEADD(day, -60, GETDATE())
              AND last_txn < DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS inactive_30_60d,
    SUM(vol_30d) AS volume_30d,
    SUM(vol_30_60d) AS volume_30_60d,
    ROUND(SUM(completed_30d) * 100.0 / NULLIF(SUM(txns_30d), 0), 2) AS success_rate_30d,
    ROUND(SUM(delivery_min_sum_30d) * 1.0 / NULLIF(SUM(delivery_count_30d), 0), 1) AS avg_delivery_min_30d,
    ROUND(SUM(stuck_count) * 100.0 / NULLIF(SUM(total_txns), 0), 2) AS stuck_rate_pct,
    GETDATE() AS refreshed_at
FROM user_corridor
GROUP BY currency_from;
`;

// Q6: Monthly Trends (Rolling 12 Months)
const QUERY_MONTHLY_TRENDS = `
SELECT
    DATE_TRUNC('month', created_at) AS month,
    COUNT(*) AS total_txns,
    COUNT(DISTINCT user_id) AS unique_users,
    SUM(send_amount) AS total_volume,
    SUM(CASE WHEN og_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN og_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
    ROUND(
        SUM(CASE WHEN og_status = 'COMPLETED' THEN 1.0 ELSE 0 END) /
        NULLIF(COUNT(*), 0) * 100, 2
    ) AS success_rate_pct,
    ROUND(AVG(CASE WHEN og_status = 'COMPLETED'
              THEN DATEDIFF(minute, created_at, updated_at) END), 1) AS avg_delivery_min,
    GETDATE() AS refreshed_at
FROM analytics_orders_master_data
WHERE created_at >= DATEADD(month, -12, GETDATE())
  AND user_id IS NOT NULL
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month;
`;

// Q7: Prediction Validation (Self-Learning feedback loop)
const QUERY_PREDICTION_VALIDATION = `
WITH predictions_60d_ago AS (
    SELECT
        user_id, risk_tier, churn_probability, predicted_at, model_version
    FROM churn_predictions
    WHERE predicted_at <= DATEADD(day, -60, GETDATE())
      AND predicted_at >= DATEADD(day, -90, GETDATE())
),
actual_activity AS (
    SELECT
        p.user_id, p.risk_tier, p.churn_probability, p.predicted_at, p.model_version,
        COUNT(a.user_id) AS txns_after_prediction
    FROM predictions_60d_ago p
    LEFT JOIN analytics_orders_master_data a
        ON p.user_id = a.user_id
        AND a.created_at >= p.predicted_at
        AND a.created_at < DATEADD(day, 60, p.predicted_at)
        AND a.og_status = 'COMPLETED'
    GROUP BY p.user_id, p.risk_tier, p.churn_probability, p.predicted_at, p.model_version
)
SELECT
    model_version, risk_tier,
    COUNT(*) AS total_predicted,
    SUM(CASE WHEN txns_after_prediction = 0 THEN 1 ELSE 0 END) AS actually_churned,
    ROUND(
        SUM(CASE WHEN txns_after_prediction = 0 THEN 1.0 ELSE 0 END) /
        NULLIF(COUNT(*), 0) * 100, 2
    ) AS actual_churn_rate_pct,
    ROUND(AVG(churn_probability) * 100, 2) AS avg_predicted_prob_pct,
    GETDATE() AS evaluated_at
FROM actual_activity
GROUP BY model_version, risk_tier
ORDER BY risk_tier;
`;

// Q9: Fulfillment Partner Performance
const QUERY_PARTNER_PERFORMANCE = `
SELECT
    COALESCE(fulfillment_provider, 'Unknown') AS partner,
    CASE currency_from
        WHEN 'AED' THEN 'UAE → India'
        WHEN 'GBP' THEN 'UK → India'
        WHEN 'USD' THEN 'US → India'
        ELSE 'Other'
    END AS corridor,
    COUNT(*) AS total_orders,
    SUM(CASE WHEN og_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN og_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
    ROUND(
        SUM(CASE WHEN og_status = 'FAILED' THEN 1.0 ELSE 0 END) /
        NULLIF(COUNT(*), 0) * 100, 2
    ) AS failure_rate_pct,
    ROUND(AVG(CASE WHEN og_status = 'COMPLETED'
              THEN DATEDIFF(minute, created_at, updated_at) END), 1) AS avg_delivery_min,
    ROUND(
        SUM(CASE WHEN og_status = 'COMPLETED'
                  AND DATEDIFF(minute, created_at, updated_at) > 60 THEN 1.0 ELSE 0 END) /
        NULLIF(SUM(CASE WHEN og_status = 'COMPLETED' THEN 1.0 ELSE 0 END), 0) * 100, 2
    ) AS pct_over_1hr,
    SUM(send_amount) AS total_volume,
    GETDATE() AS refreshed_at
FROM analytics_orders_master_data
WHERE created_at >= DATEADD(month, -3, GETDATE())
  AND user_id IS NOT NULL
GROUP BY fulfillment_provider, currency_from
HAVING COUNT(*) >= 10
ORDER BY failure_rate_pct DESC;
`;

// Q10: New User Cohort Tracking (single-pass, no self-join)
const QUERY_NEW_USER_COHORTS = `
WITH user_stats AS (
    SELECT
        user_id,
        MIN(created_at) AS first_txn_date,
        MAX(created_at) AS last_txn,
        DATE_TRUNC('week', MIN(created_at)) AS cohort_week,
        COUNT(*) AS total_txns,
        SUM(CASE WHEN og_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN og_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
        DATEDIFF(day, MAX(created_at), GETDATE()) AS days_since_last
    FROM analytics_orders_master_data
    WHERE created_at >= DATEADD(month, -6, GETDATE())
      AND user_id IS NOT NULL
    GROUP BY user_id
)
SELECT
    cohort_week,
    COUNT(*) AS cohort_size,
    ROUND(AVG(total_txns), 1) AS avg_txns_90d,
    ROUND(SUM(CASE WHEN total_txns >= 2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_2nd_txn,
    ROUND(SUM(CASE WHEN total_txns >= 5 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_5th_txn,
    ROUND(SUM(CASE WHEN completed >= 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_had_success,
    ROUND(SUM(CASE WHEN days_since_last > 60 AND total_txns >= 2 THEN 1.0 ELSE 0 END) /
          NULLIF(COUNT(*), 0) * 100, 1) AS churn_rate_pct,
    ROUND(AVG(CASE WHEN failed > 0 THEN failed * 1.0 / NULLIF(total_txns, 0) ELSE 0 END) * 100, 1) AS avg_fail_rate_pct,
    GETDATE() AS refreshed_at
FROM user_stats
GROUP BY cohort_week
ORDER BY cohort_week;
`;

// Q11: Decagon Conversations — last interaction per user (sentiment analysis)
const QUERY_DECAGON_CONVERSATIONS = `
SELECT user_id, summary AS conversation_summary, created_at,
       resolution AS status, destination AS channel,
       csat_rating AS rating, resolution AS resolution_status,
       conversation_id, tag_name_0, tag_name_1
FROM (
    SELECT
        dc.user_id,
        dc.summary,
        dc.created_at,
        dc.resolution,
        dc.destination,
        dc.csat_rating,
        dc.conversation_id,
        dc.tag_name_0,
        dc.tag_name_1,
        ROW_NUMBER() OVER (PARTITION BY dc.user_id ORDER BY dc.created_at DESC) AS rn
    FROM decagon_conversations dc
    WHERE dc.created_at >= DATEADD(month, -6, GETDATE())
      AND dc.user_id IS NOT NULL
      AND dc.summary IS NOT NULL
      AND dc.summary != ''
) sub
WHERE rn <= 3
ORDER BY user_id, created_at DESC
LIMIT 5000;
`;

// DDL: Create predictions table (run once)
const DDL_PREDICTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS churn_predictions (
    id BIGINT IDENTITY(1,1),
    user_id VARCHAR(64) NOT NULL,
    predicted_at TIMESTAMP DEFAULT GETDATE(),
    risk_tier VARCHAR(20),
    churn_probability FLOAT,
    risk_score FLOAT,
    model_version VARCHAR(20),
    corridor VARCHAR(30),
    days_since_last INT,
    total_txns INT,
    intervention_type VARCHAR(50),
    intervention_sent BOOLEAN DEFAULT FALSE,
    intervention_sent_at TIMESTAMP,
    actual_outcome VARCHAR(20),
    outcome_evaluated_at TIMESTAMP
);
CREATE INDEX idx_predictions_user ON churn_predictions(user_id);
CREATE INDEX idx_predictions_date ON churn_predictions(predicted_at);
CREATE INDEX idx_predictions_tier ON churn_predictions(risk_tier);
`;

// All queries with metadata
const QUERIES = {
  transactions:        { sql: QUERY_TRANSACTIONS,          name: 'Transaction Data',       refresh: '6h' },
  delivery:            { sql: QUERY_DELIVERY,              name: 'Delivery Metrics',       refresh: '6h' },
  pricing:             { sql: QUERY_PRICING,               name: 'Pricing Cohorts',        refresh: '6h' },
  early_warnings:      { sql: QUERY_EARLY_WARNINGS,        name: 'Early Warning Signals',  refresh: '6h' },
  corridor_health:     { sql: QUERY_CORRIDOR_HEALTH,       name: 'Corridor Health',        refresh: '6h' },
  monthly_trends:      { sql: QUERY_MONTHLY_TRENDS,        name: 'Monthly Trends',         refresh: '6h' },
  prediction_validation: { sql: QUERY_PREDICTION_VALIDATION, name: 'Prediction Validation', refresh: '24h' },
  partner_performance: { sql: QUERY_PARTNER_PERFORMANCE,   name: 'Partner Performance',    refresh: '6h' },
  new_user_cohorts:    { sql: QUERY_NEW_USER_COHORTS,      name: 'New User Cohorts',       refresh: '6h' },
  decagon_conversations: { sql: QUERY_DECAGON_CONVERSATIONS, name: 'Decagon Conversations',  refresh: '6h' },
};

module.exports = {
  QUERIES,
  DDL_PREDICTIONS_TABLE,
  QUERY_TRANSACTIONS,
  QUERY_DELIVERY,
  QUERY_PRICING,
  QUERY_EARLY_WARNINGS,
  QUERY_CORRIDOR_HEALTH,
  QUERY_MONTHLY_TRENDS,
  QUERY_PREDICTION_VALIDATION,
  QUERY_PARTNER_PERFORMANCE,
  QUERY_NEW_USER_COHORTS,
  QUERY_DECAGON_CONVERSATIONS,
};
