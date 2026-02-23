export const TABS = [
  { key: 'warroom', label: 'War Room', path: '/warroom' },
  { key: 'explorer', label: 'Risk Explorer', path: '/explorer' },
  { key: 'simulator', label: 'Simulator', path: '/simulator' },
  { key: 'command', label: 'Command Center', path: '/command' },
] as const

export const PLAYBOOKS = [
  { key: 're_engagement', label: 'Re-engagement' },
  { key: 'priority_queue', label: 'Priority Queue' },
  { key: 'support_callback', label: 'Support Callback' },
  { key: 'speed_guarantee', label: 'Speed Guarantee' },
  { key: 'loyalty_discount', label: 'Loyalty Discount' },
] as const

export const TIERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export type RiskTier = (typeof TIERS)[number]
