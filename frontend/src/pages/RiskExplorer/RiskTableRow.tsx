import { useDrawer } from '../../hooks/useDrawer'
import { Badge } from '../../components/ui/Badge'
import { fmtCurrency, tierColor } from '../../services/formatters'
import type { User } from '../../types'

interface Props { user: User }

export function RiskTableRow({ user }: Props) {
  const { openDrawer } = useDrawer()
  const u = user
  const score = u.churn_probability != null ? (u.churn_probability * 100).toFixed(0) + '%' : u.ml_score != null ? u.ml_score.toFixed(0) + '%' : '-'

  return (
    <tr
      onClick={() => openDrawer(u)}
      className="border-b border-border/10 hover:bg-surface-2/50 cursor-pointer transition-colors"
    >
      <td className="px-3 py-2.5 text-xs font-mono tracking-tight">{u.user_id}</td>
      <td className="px-3 py-2.5"><Badge label={u.risk_tier} tier={u.risk_tier} /></td>
      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: tierColor(u.risk_tier) }}>{score}</td>
      <td className="px-3 py-2.5 text-xs text-text-secondary tracking-tight">{u.corridor || '-'}</td>
      <td className="px-3 py-2.5 text-xs tracking-tight">{fmtCurrency(u.total_volume)}</td>
      <td className="px-3 py-2.5 text-xs tracking-tight">{u.days_since_last ?? '-'}d</td>
      <td className="px-3 py-2.5 text-xs tracking-tight">{u.risk_signals ?? 0}</td>
      <td className="px-3 py-2.5 text-xs text-text-tertiary tracking-tight truncate max-w-[160px]">{u.primary_reason || u.reasons?.[0]?.description || '-'}</td>
      <td className="px-3 py-2.5 text-xs text-text-tertiary tracking-tight">{u.intervention?.type?.replace(/_/g, ' ') || '-'}</td>
    </tr>
  )
}
