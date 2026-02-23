import { Card } from '../../components/ui/Card'
import type { ShapResponse } from '../../types/api'

interface Props { shap: ShapResponse | null }

export function PerUserShap({ shap }: Props) {
  const topUsers = (shap?.user_shap || []).slice(0, 6)

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Per-User SHAP Drivers</div>
      {topUsers.length === 0 ? (
        <div className="text-center py-10 text-text-tertiary text-sm">No per-user SHAP data</div>
      ) : (
        <div className="space-y-3">
          {topUsers.map(u => (
            <div key={u.user_id} className="bg-surface-2 rounded-[10px] p-3">
              <div className="text-xs font-mono font-semibold tracking-tight mb-2">{u.user_id}</div>
              <div className="flex flex-wrap gap-1.5">
                {u.drivers.slice(0, 4).map((d, i) => (
                  <span
                    key={i}
                    className={`text-[10px] px-2 py-[2px] rounded-md border ${
                      d.value >= 0
                        ? 'bg-tier-critical/10 text-tier-critical border-tier-critical/30'
                        : 'bg-tier-low/10 text-tier-low border-tier-low/30'
                    }`}
                  >
                    {d.feature.replace(/_/g, ' ')}: {d.value >= 0 ? '+' : ''}{d.value.toFixed(3)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
