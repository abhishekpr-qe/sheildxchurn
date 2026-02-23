import { Card } from '../../components/ui/Card'
import type { ModelInfo } from '../../types'

interface Props { model: ModelInfo | null }

export function ModelPerformance({ model }: Props) {
  if (!model) {
    return (
      <Card>
        <div className="text-[15px] font-semibold tracking-tight mb-3.5">Model Performance</div>
        <div className="text-center py-10 text-text-tertiary text-sm">No model data</div>
      </Card>
    )
  }

  const specs = [
    { label: 'Type', value: model.type || 'Ensemble' },
    { label: 'Features', value: model.features?.toString() || '43' },
    { label: 'Train AUC', value: model.metrics.train?.auc?.toFixed(4) || '-' },
    { label: 'Val AUC', value: model.metrics.validation?.auc?.toFixed(4) || '-' },
    { label: 'Test AUC', value: model.metrics.test?.auc?.toFixed(4) || '-', highlight: true },
    { label: 'Precision@K', value: model.metrics.precision_at_k?.toFixed(4) || '-' },
  ]

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Model Performance</div>
      <div className="space-y-2.5">
        {specs.map(s => (
          <div key={s.label} className="flex justify-between items-center">
            <span className="text-xs text-text-tertiary tracking-tight">{s.label}</span>
            <span className={`text-sm font-mono font-semibold tracking-tight ${s.highlight ? 'text-accent' : 'text-text-primary'}`}>
              {s.value}
            </span>
          </div>
        ))}
      </div>
      {model.version && (
        <div className="mt-3 pt-3 border-t border-border text-[10px] text-text-tertiary tracking-tight">
          Version: {model.version}
        </div>
      )}
    </Card>
  )
}
