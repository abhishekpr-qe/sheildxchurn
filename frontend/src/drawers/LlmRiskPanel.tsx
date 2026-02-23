import { Card } from '../components/ui/Card'
import type { Dossier } from '../types'

interface Props { dossier: Dossier | null }

function renderPlan(plan: Dossier['llm_intervention_plan']) {
  if (!plan) return null
  if (typeof plan === 'string') {
    return <p className="text-xs text-text-secondary leading-relaxed tracking-tight">{plan}</p>
  }
  const steps = [
    { key: 'primary', label: 'Primary', data: plan.primary },
    { key: 'secondary', label: 'Secondary', data: plan.secondary },
    { key: 'tertiary', label: 'Tertiary', data: plan.tertiary },
  ].filter(s => s.data)

  return (
    <div className="space-y-2">
      {steps.map(s => (
        <div key={s.key} className="bg-surface-2 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-semibold text-accent uppercase tracking-tight">{s.label}</span>
            <span className="text-[10px] text-text-tertiary">{s.data!.channel} &middot; {s.data!.timing}</span>
          </div>
          <div className="text-xs text-text-secondary tracking-tight">{s.data!.action}</div>
        </div>
      ))}
    </div>
  )
}

export function LlmRiskPanel({ dossier }: Props) {
  if (!dossier?.llm_risk_signals?.length && !dossier?.llm_intervention_plan) return null

  return (
    <Card>
      <div className="text-xs font-semibold tracking-tight text-accent mb-2">LLM Risk Analysis</div>
      {dossier.llm_risk_signals && dossier.llm_risk_signals.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight mb-1">Risk Signals</div>
          <div className="space-y-1">
            {dossier.llm_risk_signals.map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs text-text-secondary tracking-tight">{s.signal}</span>
                <span className={`text-[10px] px-1.5 py-[1px] rounded font-semibold uppercase tracking-tight ${
                  s.severity === 'high' ? 'bg-red-500/10 text-red-600' :
                  s.severity === 'medium' ? 'bg-yellow-500/10 text-yellow-600' :
                  'bg-zinc-500/10 text-zinc-500'
                }`}>{s.severity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {dossier.llm_intervention_plan && (
        <div className="mb-2">
          <div className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight mb-1">Intervention Plan</div>
          {renderPlan(dossier.llm_intervention_plan)}
        </div>
      )}
      {dossier.llm_justification && (
        <div className="mb-2">
          <div className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight mb-1">Justification</div>
          <p className="text-xs text-text-secondary leading-relaxed tracking-tight">{dossier.llm_justification}</p>
        </div>
      )}
      <div className="flex gap-4 text-[10px] text-text-tertiary">
        {dossier.llm_urgency && <span>Urgency: {dossier.llm_urgency}</span>}
        {dossier.llm_confidence != null && <span>LLM Confidence: {(dossier.llm_confidence * 100).toFixed(0)}%</span>}
      </div>
    </Card>
  )
}
