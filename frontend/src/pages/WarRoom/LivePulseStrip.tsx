import { StatPill } from '../../components/ui/StatPill'
import { fmtNumber } from '../../services/formatters'
import { useApi } from '../../hooks/useApi'

interface MixpanelOverview {
  daily_snapshot: {
    total_events: number
    daily_active_users: number
    orders_created: number
    orders_completed: number
    orders_failed: number
    sessions: number
  }
}

export function LivePulseStrip() {
  const { data, loading } = useApi<MixpanelOverview>('/api/mixpanel/overview')
  const daily = data?.daily_snapshot

  const pills = [
    { label: 'DAU', value: fmtNumber(daily?.daily_active_users ?? null), color: '#22C55E' },
    { label: 'Events Today', value: fmtNumber(daily?.total_events ?? null), color: '#7C57CC' },
    { label: 'Orders', value: fmtNumber(daily?.orders_created ?? null), color: '#6366F1' },
    { label: 'Completed', value: fmtNumber(daily?.orders_completed ?? null), color: '#22C55E' },
    { label: 'Sessions', value: fmtNumber(daily?.sessions ?? null), color: '#F59E0B' },
  ]

  if (loading) return <div className="flex gap-3 overflow-x-auto pb-1 animate-pulse h-8" />

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {pills.map(p => (
        <StatPill key={p.label} label={p.label} value={p.value} color={p.color} />
      ))}
    </div>
  )
}
