import { Card } from '../components/ui/Card'
import type { Dossier } from '../types'

interface Props { dossier: Dossier | null }

export function AiDossier({ dossier }: Props) {
  if (!dossier?.ai_summary) return null

  return (
    <Card glass>
      <div className="text-xs font-semibold tracking-tight text-accent mb-2">AI Summary</div>
      <p className="text-sm text-text-secondary leading-relaxed tracking-tight">{dossier.ai_summary}</p>
      {dossier.confidence && (
        <div className="text-[10px] text-text-tertiary mt-2">Confidence: {(dossier.confidence * 100).toFixed(0)}%</div>
      )}
    </Card>
  )
}
