import { TIER_COLORS } from '../../config/theme'
import type { User } from '../../types'

interface TierDistributionBarProps {
  users: User[]
}

export function TierDistributionBar({ users }: TierDistributionBarProps) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  users.forEach(u => { if (u.risk_tier in counts) counts[u.risk_tier as keyof typeof counts]++ })
  const total = users.length || 1

  return (
    <div className="mb-3.5">
      <div className="flex h-10 rounded-[10px] overflow-hidden gap-0.5">
        {(Object.entries(counts) as [keyof typeof counts, number][]).map(([tier, count]) => {
          const pct = (count / total) * 100
          if (pct === 0) return null
          return (
            <div
              key={tier}
              className="flex items-center justify-center text-xs font-semibold tracking-tight text-white rounded-lg transition-all"
              style={{ width: `${pct}%`, background: TIER_COLORS[tier] }}
            >
              {pct > 8 ? `${tier} ${count}` : count > 0 ? count : ''}
            </div>
          )
        })}
      </div>
      <div className="flex gap-4 mt-2">
        {(Object.entries(counts) as [keyof typeof counts, number][]).map(([tier, count]) => (
          <div key={tier} className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
            <span className="w-2 h-2 rounded-full" style={{ background: TIER_COLORS[tier] }} />
            {tier}: {count}
          </div>
        ))}
      </div>
    </div>
  )
}
