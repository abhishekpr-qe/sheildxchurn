import { fmtNumber, fmtCurrency } from '../services/formatters'
import type { User, Dossier } from '../types'

interface Props { user: User; dossier: Dossier | null }

export function UserStatsGrid({ user, dossier }: Props) {
  const d = dossier || user
  const stats = [
    { label: 'Corridor', value: (d as User).corridor || '-' },
    { label: 'Tenure', value: `${(d as User).tenure_days || 0}d` },
    { label: 'Total Txns', value: fmtNumber((d as User).total_txns) },
    { label: 'Volume', value: fmtCurrency((d as User).total_volume) },
    { label: 'Days Inactive', value: `${dossier?.days_inactive ?? (user as User).days_since_last ?? '-'}d` },
    { label: 'Fail Rate', value: user.fail_rate != null ? `${(user.fail_rate * 100).toFixed(1)}%` : '-' },
  ]

  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map(s => (
        <div key={s.label} className="bg-surface-2 rounded-[10px] px-3 py-2">
          <div className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight">{s.label}</div>
          <div className="text-sm font-semibold tracking-tight">{s.value}</div>
        </div>
      ))}
    </div>
  )
}
