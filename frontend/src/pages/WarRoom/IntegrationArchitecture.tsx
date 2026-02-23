import { Card } from '../../components/ui/Card'
import type { Integrations } from '../../types'

interface Props { integrations: Integrations | null }

const INTEGRATIONS = [
  { key: 'redshift', label: 'Redshift', desc: 'Data warehouse' },
  { key: 'mixpanel', label: 'Mixpanel', desc: 'Product analytics' },
  { key: 'anthropic', label: 'Anthropic', desc: 'AI/LLM' },
  { key: 'moengage', label: 'MoEngage', desc: 'Engagement' },
  { key: 's3', label: 'S3', desc: 'Audit trail' },
] as const

function statusDot(status?: string) {
  if (status === 'connected') return 'bg-tier-low shadow-[0_0_6px_rgba(34,197,94,0.5)]'
  if (status === 'configured') return 'bg-tier-high shadow-[0_0_6px_rgba(245,158,11,0.5)]'
  return 'bg-tier-critical'
}

export function IntegrationArchitecture({ integrations }: Props) {
  return (
    <div className="grid grid-cols-5 gap-3.5">
      {INTEGRATIONS.map(int => {
        const status = integrations?.[int.key as keyof Integrations]?.status
        return (
          <Card key={int.key} glass>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${statusDot(status)}`} />
              <span className="text-xs font-semibold tracking-tight">{int.label}</span>
            </div>
            <div className="text-[10px] text-text-tertiary tracking-tight">{int.desc}</div>
            <div className="text-[10px] text-text-tertiary mt-1 capitalize">{status || 'unknown'}</div>
          </Card>
        )
      })}
    </div>
  )
}
