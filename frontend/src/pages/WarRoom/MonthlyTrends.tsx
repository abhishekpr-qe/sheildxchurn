import { Card } from '../../components/ui/Card'
import { BarChart } from '../../components/charts/BarChart'
import type { MonthlyTrend } from '../../types'

interface Props { trends: MonthlyTrend[] }

export function MonthlyTrends({ trends }: Props) {
  const categories = trends.map(t => t.month)
  const series = [{ name: 'Volume', data: trends.map(t => t.total_volume || 0) }]

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Monthly Volume Trends</div>
      {trends.length > 0 ? (
        <BarChart categories={categories} series={series} colors={['#7C57CC']} height={280} />
      ) : (
        <div className="text-center py-10 text-text-tertiary text-sm">No trend data</div>
      )}
    </Card>
  )
}
