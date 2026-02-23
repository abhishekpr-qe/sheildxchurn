import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import { TIER_COLORS } from '../../config/theme'
import { TIERS } from '../../config/constants'
import { api } from '../../services/api-client'
import type { User } from '../../types'

interface Props { users: User[] }

export function TierCampaignGrid({ users }: Props) {
  const [launching, setLaunching] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, string>>({})

  const tierCounts: Record<string, number> = {}
  TIERS.forEach(t => { tierCounts[t] = 0 })
  users.forEach(u => { if (u.risk_tier in tierCounts) tierCounts[u.risk_tier]++ })

  async function launch(tier: string) {
    setLaunching(tier)
    try {
      const res = await api.post<{ targeted: number; campaign_id: string }>('/api/moengage/bulk', { tier })
      setResult(prev => ({ ...prev, [tier]: `${res.targeted} targeted` }))
    } catch (e) {
      setResult(prev => ({ ...prev, [tier]: e instanceof Error ? e.message : 'Failed' }))
    } finally {
      setLaunching(null)
    }
  }

  return (
    <div className="grid grid-cols-4 gap-3.5">
      {TIERS.map(tier => (
        <Card key={tier}>
          <div className="flex items-center justify-between mb-3">
            <Badge label={tier} tier={tier} />
            <span className="text-2xl font-bold tracking-[-1.5px]" style={{ color: TIER_COLORS[tier] }}>
              {tierCounts[tier]}
            </span>
          </div>
          <div className="text-xs text-text-tertiary mb-3">users in tier</div>
          <Button
            size="sm"
            variant={tier === 'CRITICAL' ? 'danger' : tier === 'HIGH' ? 'warning' : 'outline'}
            onClick={() => launch(tier)}
            disabled={launching === tier || tierCounts[tier] === 0}
            className="w-full"
          >
            {launching === tier ? <Spinner className="w-3 h-3" /> : 'Launch Campaign'}
          </Button>
          {result[tier] && (
            <div className="text-[10px] text-text-tertiary mt-2 text-center">{result[tier]}</div>
          )}
        </Card>
      ))}
    </div>
  )
}
