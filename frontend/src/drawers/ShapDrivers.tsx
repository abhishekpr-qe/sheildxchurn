import { Card } from '../components/ui/Card'
import type { ShapDriver } from '../types'

interface Props { drivers: ShapDriver[] }

export function ShapDrivers({ drivers }: Props) {
  if (drivers.length === 0) return null

  return (
    <Card>
      <div className="text-xs font-semibold tracking-tight mb-2.5">SHAP Drivers</div>
      <div className="space-y-1.5">
        {drivers.slice(0, 6).map((d, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-xs text-text-secondary tracking-tight">{d.feature.replace(/_/g, ' ')}</span>
            <span className={`text-xs font-mono font-semibold ${d.value >= 0 ? 'text-tier-critical' : 'text-tier-low'}`}>
              {d.value >= 0 ? '+' : ''}{d.value.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
