import { useApi } from '../../hooks/useApi'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import { fmtTimeAgo } from '../../services/formatters'
import type { InterventionLog as ILog } from '../../types'

export function InterventionLog() {
  const { data, loading } = useApi<ILog[]>('/api/interventions/log')
  const logs = data || []

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Recent Interventions</div>
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-text-tertiary text-sm">No interventions yet</div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {logs.slice(0, 20).map(log => (
            <div key={log.id} className="flex items-center justify-between bg-surface-2 rounded-[10px] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono tracking-tight">{log.user_id}</span>
                <Badge label={log.tier} tier={log.tier} />
              </div>
              <div className="flex items-center gap-3 text-[10px] text-text-tertiary">
                <span>{log.channel}</span>
                <span className={log.outcome === 'retained' ? 'text-tier-low' : log.outcome === 'churned' ? 'text-tier-critical' : ''}>
                  {log.outcome || log.status}
                </span>
                <span>{fmtTimeAgo(log.triggered_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
