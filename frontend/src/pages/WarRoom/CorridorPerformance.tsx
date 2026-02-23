import { Card } from '../../components/ui/Card'
import { BarChart } from '../../components/charts/BarChart'
import type { CorridorAnalysis } from '../../types'

interface Props { corridors: CorridorAnalysis }

export function CorridorPerformance({ corridors }: Props) {
  const entries = Object.entries(corridors).sort((a, b) => b[1].total - a[1].total)
  const categories = entries.map(([k]) => k)
  const series = [{ name: 'Users', data: entries.map(([, v]) => v.total) }]

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Corridor Performance</div>
      {entries.length > 0 ? (
        <BarChart categories={categories} series={series} horizontal gradient colors={['#7C57CC']} height={280} />
      ) : (
        <div className="text-center py-10 text-text-tertiary text-sm">No corridor data</div>
      )}
    </Card>
  )
}
