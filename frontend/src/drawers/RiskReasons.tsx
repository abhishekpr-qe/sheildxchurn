import { Card } from '../components/ui/Card'

interface Props { reasons: { code: string; description: string }[] }

export function RiskReasons({ reasons }: Props) {
  if (reasons.length === 0) return null

  return (
    <Card>
      <div className="text-xs font-semibold tracking-tight mb-2.5">Risk Reasons</div>
      <div className="space-y-1.5">
        {reasons.map((r, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-tier-critical mt-0.5 text-[10px]">-</span>
            <span className="text-xs text-text-secondary tracking-tight">{r.description}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
