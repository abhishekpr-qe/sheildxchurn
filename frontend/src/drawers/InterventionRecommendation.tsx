import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import type { Dossier, User } from '../types'

interface Props { dossier: Dossier | null; user: User }

export function InterventionRecommendation({ dossier, user }: Props) {
  const int = dossier?.recommended_intervention || user.intervention
  if (!int) return null

  const nudges = dossier?.nudge_sequence || []

  return (
    <Card hero>
      <div className="text-xs font-semibold tracking-tight text-accent mb-2">Recommended Intervention</div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold tracking-tight">{int.type.replace(/_/g, ' ')}</span>
        <Badge label={int.channel} />
      </div>
      <p className="text-xs text-text-secondary tracking-tight mb-2">{int.message}</p>
      <div className="flex gap-4 text-[10px] text-text-tertiary">
        <span>Cost: ${int.cost}</span>
        <span>Lift: {int.lift}</span>
        {dossier?.expected_uplift && <span>Uplift: {dossier.expected_uplift}</span>}
      </div>
      {nudges.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-tight mb-1.5">Nudge Sequence</div>
          <div className="space-y-1">
            {nudges.map((n, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] text-text-secondary">
                <span className="text-text-tertiary font-semibold">Day {n.day}:</span>
                <span>{n.action}</span>
                <span className="text-text-tertiary">via {n.channel}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
