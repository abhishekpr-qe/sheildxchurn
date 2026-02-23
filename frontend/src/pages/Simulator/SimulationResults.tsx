import { MetricCard } from '../../components/ui/MetricCard'
import { fmtNumber, fmtCurrency, fmtPercent } from '../../services/formatters'
import type { SimulationResult } from '../../types'

interface Props { result: SimulationResult }

export function SimulationResults({ result }: Props) {
  const r = result
  return (
    <div className="space-y-3.5 animate-fade-in">
      <div className="grid grid-cols-4 gap-3.5">
        <MetricCard label="Target Users" value={fmtNumber(r.target_users)} glass />
        <MetricCard label="Expected Retained" value={fmtNumber(r.expected_retained)} color="#22C55E" glass />
        <MetricCard label="Lift Rate" value={fmtPercent(r.lift_rate)} color="#7C57CC" glass />
        <MetricCard label="ROI" value={r.roi?.toFixed(1) + 'x'} color="#F59E0B" glass />
      </div>
      <div className="grid grid-cols-3 gap-3.5">
        <MetricCard label="Projected Revenue" value={fmtCurrency(r.projected_revenue)} color="#22C55E" />
        <MetricCard label="Projected Cost" value={fmtCurrency(r.projected_cost)} color="#EF4444" />
        <MetricCard label="Net Profit" value={fmtCurrency(r.net_profit)} color={r.net_profit >= 0 ? '#22C55E' : '#EF4444'} />
      </div>
    </div>
  )
}
