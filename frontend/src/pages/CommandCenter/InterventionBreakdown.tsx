import { Card } from '../../components/ui/Card'
import { DonutChart } from '../../components/charts/DonutChart'
import type { User } from '../../types'

interface Props { users: User[] }

export function InterventionBreakdown({ users }: Props) {
  const counts: Record<string, number> = {}
  users.forEach(u => {
    const type = u.intervention?.type || 'unknown'
    counts[type] = (counts[type] || 0) + 1
  })

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const labels = entries.map(([k]) => k.replace(/_/g, ' '))
  const series = entries.map(([, v]) => v)

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Intervention Breakdown</div>
      {entries.length > 0 ? (
        <DonutChart labels={labels} series={series} height={280} />
      ) : (
        <div className="text-center py-10 text-text-tertiary text-sm">No intervention data</div>
      )}
    </Card>
  )
}
