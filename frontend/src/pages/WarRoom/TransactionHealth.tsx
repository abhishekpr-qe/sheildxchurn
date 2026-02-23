import { Card } from '../../components/ui/Card'
import { BarChart } from '../../components/charts/BarChart'
import type { TransactionStatus } from '../../types'

interface Props { status: TransactionStatus }

export function TransactionHealth({ status }: Props) {
  const entries = Object.entries(status).sort((a, b) => b[1] - a[1])
  const categories = entries.map(([k]) => k)
  const series = [{ name: 'Count', data: entries.map(([, v]) => v) }]
  const colors = categories.map(c => {
    if (c.includes('COMPLETED') || c.includes('completed')) return '#22C55E'
    if (c.includes('FAILED') || c.includes('failed')) return '#EF4444'
    if (c.includes('STUCK') || c.includes('stuck')) return '#F59E0B'
    return '#6366F1'
  })

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Transaction Health</div>
      {entries.length > 0 ? (
        <BarChart categories={categories} series={series} horizontal colors={[colors[0] || '#7C57CC']} height={280} />
      ) : (
        <div className="text-center py-10 text-text-tertiary text-sm">No transaction data</div>
      )}
    </Card>
  )
}
