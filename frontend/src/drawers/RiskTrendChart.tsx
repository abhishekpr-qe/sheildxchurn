import { Card } from '../components/ui/Card'
import { AreaChart } from '../components/charts/AreaChart'

interface Props { userId: string }

export function RiskTrendChart({ userId: _userId }: Props) {
  const mockData = [0.3, 0.35, 0.4, 0.45, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]
  const categories = mockData.map((_, i) => `W${i + 1}`)

  return (
    <Card>
      <div className="text-xs font-semibold tracking-tight mb-2">Risk Trend</div>
      <AreaChart
        categories={categories}
        series={[{ name: 'Risk Score', data: mockData }]}
        height={120}
        color="#EF4444"
        sparkline
      />
    </Card>
  )
}
