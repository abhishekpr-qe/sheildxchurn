import { MetricCard } from '../../components/ui/MetricCard'
import { fmtNumber, fmtPercent, fmtCurrency } from '../../services/formatters'
import type { Executive } from '../../types'

interface Props { executive: Executive | null }

export function KpiGrid({ executive: ex }: Props) {
  const metrics = [
    { label: 'Total Users', value: fmtNumber(ex?.total_users ?? null) },
    { label: 'Active (30d)', value: fmtNumber(ex?.active_30d ?? null), color: '#22C55E' },
    { label: 'At Risk', value: fmtNumber(ex?.at_risk ?? null), color: '#F59E0B' },
    { label: 'Baseline Churn', value: fmtPercent(ex?.churn_rate_baseline ?? null), color: '#EF4444' },
    { label: 'Predicted 30d', value: fmtNumber(ex?.predicted_churn_30d ?? null), color: '#EF4444' },
    { label: 'Revenue at Risk', value: fmtCurrency(ex?.revenue_at_risk ?? null), color: '#EF4444' },
    { label: 'Monthly Net Benefit', value: fmtCurrency(ex?.monthly_net_benefit ?? null), color: '#22C55E' },
    { label: 'ROI', value: ex?.roi_multiple != null ? ex.roi_multiple.toFixed(1) + 'x' : '-', color: '#7C57CC' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3.5">
      {metrics.map(m => (
        <MetricCard key={m.label} label={m.label} value={m.value} color={m.color} glass />
      ))}
    </div>
  )
}
