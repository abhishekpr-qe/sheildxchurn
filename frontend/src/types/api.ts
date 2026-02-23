export interface LiveDataResponse<T = unknown> {
  source: string
  rows: T[]
  row_count: number
  error?: string
  last_refresh?: string
}

export interface ApiError {
  error: string
  detail?: string
}

export interface RefreshResponse {
  status: string
  timestamp: string
  sources: Record<string, unknown>
}

export interface ShapResponse {
  user_shap: { user_id: string; drivers: { feature: string; value: number }[] }[]
  feature_importance: Record<string, number>
}

export interface ImpactResponse {
  total_churned: number
  avg_annual_revenue_per_user: number
  scenarios: { label: string; saved: number; revenue: number }[]
  intervention_cost: number
  roi_multiple: number
}

export interface AiChatResponse {
  response: string
}

export interface BulkCampaignResponse {
  status: string
  tier: string
  targeted: number
  errors: number
  skipped_cooldown: number
  channel: string
  sample_users: string[]
  campaign_id: string
}
