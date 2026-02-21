/**
 * Shared JSDoc type definitions for ShieldXChurn API.
 * No runtime code — import for IntelliSense only.
 *
 * @example
 * // In any service or route file:
 * // const types = require('./types'); // unused at runtime, enables IDE hints
 */

// --- Domain Types ---

/**
 * @typedef {Object} User
 * @property {string} user_id
 * @property {string} corridor
 * @property {string} currency
 * @property {number} tenure_days
 * @property {number} total_txns
 * @property {number} completed_txns
 * @property {number} failed_txns
 * @property {number} total_volume
 * @property {number} days_since_last
 * @property {number} fail_rate
 * @property {number} avg_delivery_min
 * @property {number} stuck_rate
 * @property {number} churn_probability
 * @property {number} risk_score
 * @property {string} risk_tier - CRITICAL | HIGH | MEDIUM | LOW
 * @property {Array<{description: string, weight: string}>} reasons
 * @property {Intervention} [intervention]
 */

/**
 * @typedef {Object} Intervention
 * @property {string} type
 * @property {string} channel
 * @property {string} message
 * @property {string} lift
 * @property {number} cost
 */

/**
 * @typedef {Object} InterventionStep
 * @property {string} action
 * @property {string} channel
 * @property {string} timing
 * @property {string} message_template
 */

/**
 * @typedef {Object} RiskAnalysis
 * @property {Array<{signal: string, severity: string, evidence: string}>} risk_signals
 * @property {{primary: InterventionStep, secondary: InterventionStep, tertiary: InterventionStep}} intervention_plan
 * @property {string} justification
 * @property {string} urgency - immediate | this_week | this_month
 * @property {number} confidence
 * @property {string} source - llm | rule_based | rule_based_fallback | rule_based_parse_fallback
 */

/**
 * @typedef {Object} SentimentResult
 * @property {string} user_id
 * @property {boolean} has_conversations
 * @property {number} [conversation_count]
 * @property {string|null} [last_interaction]
 * @property {string} sentiment - positive | neutral | negative | frustrated | concerned | unknown
 * @property {string[]} pain_points
 * @property {string} summary
 * @property {string} [churn_signal] - yes | maybe | no | unknown
 * @property {string} [urgency] - immediate | soon | monitor
 * @property {ConversationSummary[]} [conversations]
 */

/**
 * @typedef {Object} ConversationSummary
 * @property {string} [date]
 * @property {string} [channel]
 * @property {string} [status]
 * @property {string} [summary]
 * @property {string|null} [resolution]
 * @property {string|null} [rating]
 * @property {string|null} [order_id]
 * @property {string[]} [user_messages]
 */

/**
 * @typedef {Object} Dossier
 * @property {string} user_id
 * @property {string} generated_at
 * @property {string} risk_tier
 * @property {number} churn_probability
 * @property {number} confidence
 * @property {string} corridor
 * @property {number} tenure_days
 * @property {number} total_txns
 * @property {number} total_volume
 * @property {number} days_inactive
 * @property {Array<{description: string, weight: string}>} churn_reasons
 * @property {Array<{feature: string, impact: number}>} shap_drivers
 * @property {{key: string, label: string}|null} cohort
 * @property {Intervention} recommended_intervention
 * @property {Array<{day: number, action: string, channel: string, message: string}>} nudge_sequence
 * @property {string} expected_uplift
 * @property {string} owner
 * @property {Object|null} timeline
 * @property {SentimentResult|null} [sentiment]
 * @property {string|null} [ai_summary]
 * @property {Array|null} [llm_risk_signals]
 * @property {Object|null} [llm_intervention_plan]
 * @property {string|null} [llm_justification]
 * @property {string|null} [llm_urgency]
 * @property {number|null} [llm_confidence]
 * @property {string|null} [llm_source]
 */

/**
 * @typedef {Object} CampaignRecord
 * @property {string} campaign_id
 * @property {string} triggered_at
 * @property {string} triggered_by
 * @property {string} tier
 * @property {string} channel_used
 * @property {boolean} llm_analysis_included
 * @property {number} total_targeted
 * @property {Array<{user_id: string, corridor: string, risk_tier: string, churn_probability: number, communication_type: string, tool_used: string, sent_at: string, intervention_type: string, intervention_message: string, status: string}>} users
 */

/**
 * @typedef {Object} InterventionLogEntry
 * @property {string} id
 * @property {string} user_id
 * @property {string} channel
 * @property {string} [campaign]
 * @property {string} [playbook]
 * @property {string} risk_tier
 * @property {number} [churn_probability]
 * @property {string} triggered_at
 * @property {string} status
 * @property {string|null} outcome
 * @property {string} [outcome_at]
 * @property {string} [notes]
 */

/**
 * @typedef {Object} Cohort
 * @property {string} key
 * @property {string} label
 * @property {string} description
 * @property {number} count
 * @property {number} churn_rate
 * @property {string} retention_strategy
 * @property {Array<{user_id: string}>} sample_users
 */

/**
 * @typedef {Object} SimulatorResult
 * @property {string} cohort
 * @property {string} playbook
 * @property {number} target_users
 * @property {number} avg_churn_probability
 * @property {number} lift_rate
 * @property {number} expected_retained
 * @property {number} projected_revenue
 * @property {number} projected_cost
 * @property {number} net_profit
 * @property {number} roi
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} error
 * @property {string} [detail]
 */

/**
 * @typedef {Object} LiveDataResponse
 * @property {string} source - cache | live | static | error | unavailable
 * @property {string[]} [columns]
 * @property {Object[]} [rows]
 * @property {number} [row_count]
 * @property {string} [error]
 * @property {string} [message]
 */

/**
 * @typedef {Object} RequestContext
 * @property {string} [reqId] - Request correlation ID from middleware
 */

module.exports = {};
