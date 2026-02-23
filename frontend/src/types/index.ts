export type RiskTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type Sentiment = 'positive' | 'negative' | 'neutral' | 'unknown'
export type InterventionType = 're_engagement' | 'priority_queue' | 'support_callback' | 'speed_guarantee' | 'loyalty_discount'
export type Channel = string

export interface ChurnReason {
  code: string
  description: string
}

export interface Intervention {
  type: InterventionType
  channel: Channel
  message: string
  cost: number
  lift: string
}

export interface User {
  user_id: string
  corridor: string
  currency: string
  tenure_days: number
  total_txns: number
  completed_txns: number
  failed_txns: number
  pending_txns: number
  total_volume: number
  completed_volume: number
  avg_amount: number
  days_since_last: number
  fail_rate: number
  stuck_rate: number
  stuck_count: number
  avg_delivery_min: number
  risk_score: number
  churn_probability: number
  risk_tier: RiskTier
  reasons: ChurnReason[]
  intervention: Intervention
  cohort: string
  first_txn: string
  last_txn: string
  source: string
  // Legacy fields still referenced by consumers
  ml_score?: number
  primary_reason?: string
  risk_signals?: number
  signal_frequency_drop?: number
  signal_volume_drop?: number
  signal_high_failures?: number
  signal_going_inactive?: number
  signal_slow_delivery?: number
  signal_stuck_now?: number
}

export interface Executive {
  total_users: number
  active_30d: number
  at_risk: number
  churn_rate_baseline: number
  churn_rate_post_intervention: number
  predicted_churn_30d: number
  revenue_at_risk: number
  retained_saved: number
  revenue_saved: number
  total_intervention_cost: number
  monthly_net_benefit: number
  roi_multiple: number
  payback_days: number
  avg_txns_per_user: number
  margin_per_txn: number
  ltv_multiplier: number
  data_source: string
  // Legacy fields still referenced by KpiGrid
  monthly_volume?: number
  monthly_txns?: number
  volume_growth?: number
}

export interface Integration {
  name: string
  status: 'connected' | 'configured' | 'not_configured'
  icon: string
  [key: string]: unknown
}

export interface Integrations {
  anthropic: Integration
  redshift: Integration
  moengage: Integration
  retell: Integration
  mixpanel: Integration
  s3: Integration
}

export interface CorridorData {
  total: number
  active_30d: number
  inactive_30_60d: number
  volume_30d: number
  volume_30_60d: number
  success_rate: number
  avg_delivery_min: number
  stuck_rate: number
  churn_rate: number
}

export interface CorridorAnalysis {
  [corridor: string]: CorridorData
}

export interface TransactionStatus {
  [status: string]: number
}

export interface ChurnOverview {
  status: Record<string, number>
  tiers: Record<string, number>
}

export interface MonthlyTrend {
  month: string
  total_users: number
  active_30d?: number
  total_volume: number
  total_txns: number
  churn_rate?: number
}

export interface PartnerPerformance {
  partner: string
  corridor: string
  total_orders: string
  completed: string
  failed: string
  failure_rate_pct: string
  avg_delivery_min: string
  pct_over_1hr: string
  total_volume: number
  refreshed_at: string
}

export interface DashboardData {
  summary: Record<string, unknown>
  model: Record<string, unknown>
  churn_overview: ChurnOverview
  corridor_analysis: CorridorAnalysis
  interventions: Record<string, unknown>
  backtest: Record<string, unknown>
  reason_frequency: Record<string, unknown>
  transaction_status: TransactionStatus
  at_risk_users: User[]
  churned_sample: User[]
  healthy_sample: User[]
  executive_impact: Record<string, unknown>
  shap_data: Record<string, unknown>
  experiments: Record<string, unknown>
  rollout: Record<string, unknown>
  mixpanel: Record<string, unknown>
  live_data: Record<string, unknown>
  // Legacy fields that may still exist in some API versions
  monthly_trends?: MonthlyTrend[]
  partner_performance?: PartnerPerformance[]
}

export interface Cohort {
  key: string
  label: string
  count: number
  churn_rate: number
  retention_strategy: Record<string, unknown>
  sample_users: User[]
}

export interface ShapDriver {
  feature: string
  value: number
  direction: 'increases' | 'decreases'
}

export interface NudgeStep {
  day: number
  action: string
  channel: string
  message: string
}

export interface LlmRiskSignal {
  signal: string
  severity: string
}

export interface Dossier {
  user_id: string
  generated_at: string
  risk_tier: RiskTier
  churn_probability: number
  confidence: number
  corridor: string
  tenure_days: number
  total_txns: number
  total_volume: number
  days_inactive: number
  churn_reasons: ChurnReason[]
  shap_drivers: ShapDriver[]
  cohort: string | null
  recommended_intervention: Intervention
  nudge_sequence: NudgeStep[]
  expected_uplift: string
  owner: string
  timeline: TimelineEvent[] | null
  sentiment: SentimentData | null
  ai_summary: string | null
  llm_risk_signals: LlmRiskSignal[]
  llm_intervention_plan: {
    primary?: { action: string; channel: string; timing: string; message_template: string }
    secondary?: { action: string; channel: string; timing: string; message_template: string }
    tertiary?: { action: string; channel: string; timing: string; message_template: string }
  } | string | null
  llm_justification: string
  llm_urgency: string
  llm_confidence: number
}

export interface SentimentData {
  user_id: string
  has_conversations: boolean
  sentiment: Sentiment
  pain_points: string[]
  summary: string
  // Legacy fields still referenced by SentimentPanel
  churn_signal?: boolean
  urgency?: number
  source?: string
  conversation_count?: number
  country?: string
}

export interface Transaction {
  [key: string]: unknown
}

export interface TimelineEvent {
  date: string
  event: string
  detail?: string
}

export interface SimulationResult {
  cohort: string
  playbook: string
  target_users: number
  avg_churn_probability: number
  lift_rate: number
  expected_retained: number
  projected_revenue: number
  projected_cost: number
  net_profit: number
  roi: number
}

export interface CampaignRecord {
  campaign_id: string
  triggered_at: string
  tier: RiskTier
  channel_used: string
  total_targeted: number
  llm_analysis_included: boolean
  s3_status: string
  s3_key?: string
}

export interface InterventionLog {
  id: string
  user_id: string
  channel: string
  tier: RiskTier
  triggered_at: string
  status: string
  outcome?: string
  source?: string
}

export interface ModelInfo {
  type: string
  metrics: {
    train?: { auc: number }
    validation?: { auc: number }
    test?: { auc: number }
    precision_at_k?: number
  }
  version?: string
  features?: number
}

export interface MixpanelDailySnapshot {
  total_events: number
  daily_active_users: number
  orders_created: number
  [key: string]: unknown
}

export interface MixpanelOverview {
  funnels: Record<string, unknown>
  engage_stats: { total: number }
  last_refresh: string
  daily_snapshot: MixpanelDailySnapshot
}
