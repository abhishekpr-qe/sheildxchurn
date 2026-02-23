import { Card } from '../../components/ui/Card'
import { ProgressBar } from '../../components/ui/ProgressBar'
import { fmtCurrency } from '../../services/formatters'

export function BudgetControls() {
  const budget = 10000
  const spent = 3200
  const remaining = budget - spent

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Budget & Frequency</div>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-xs mb-2">
            <span className="text-text-tertiary">Monthly Budget</span>
            <span className="font-semibold">{fmtCurrency(budget)}</span>
          </div>
          <ProgressBar label="Spent" value={spent} max={budget} color="#7C57CC" formatValue={fmtCurrency} />
          <div className="flex justify-between text-[10px] text-text-tertiary mt-1">
            <span>Remaining: {fmtCurrency(remaining)}</span>
            <span>{((spent / budget) * 100).toFixed(0)}% used</span>
          </div>
        </div>
        <div className="border-t border-border pt-3">
          <div className="text-xs font-semibold tracking-tight mb-2">Frequency Caps</div>
          <div className="space-y-1.5">
            {[
              { label: 'Push notifications', cap: '1 per 48h' },
              { label: 'Email campaigns', cap: '1 per 7d' },
              { label: 'Voice calls', cap: '1 per 7d' },
              { label: 'SMS messages', cap: '1 per 72h' },
            ].map(f => (
              <div key={f.label} className="flex justify-between text-[10px] text-text-tertiary">
                <span>{f.label}</span>
                <span className="text-text-secondary font-semibold">{f.cap}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
