import { useApi } from '../../hooks/useApi'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import { fmtDate } from '../../services/formatters'
import type { CampaignRecord } from '../../types'

export function CampaignHistory() {
  const { data, loading } = useApi<{ campaigns: CampaignRecord[] }>('/api/campaigns/history')
  const campaigns = data?.campaigns || []

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Campaign History</div>
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-8 text-text-tertiary text-sm">No campaigns yet</div>
      ) : (
        <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Campaign', 'Tier', 'Channel', 'Targeted', 'S3', 'Date'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] text-text-tertiary border-b border-border uppercase tracking-tight font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.campaign_id} className="border-b border-border/10 hover:bg-surface-2/50">
                  <td className="px-3 py-2 text-[10px] font-mono tracking-tight">{c.campaign_id.slice(0, 8)}</td>
                  <td className="px-3 py-2"><Badge label={c.tier} tier={c.tier} /></td>
                  <td className="px-3 py-2 text-xs tracking-tight">{c.channel_used}</td>
                  <td className="px-3 py-2 text-xs tracking-tight">{c.total_targeted}</td>
                  <td className="px-3 py-2 text-[10px] tracking-tight">{c.s3_status}</td>
                  <td className="px-3 py-2 text-[10px] text-text-tertiary">{fmtDate(c.triggered_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
