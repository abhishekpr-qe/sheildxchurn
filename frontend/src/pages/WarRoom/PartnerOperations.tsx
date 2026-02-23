import { Card } from '../../components/ui/Card'
import { DataTable } from '../../components/ui/DataTable'
import type { PartnerPerformance } from '../../types'

interface Props { partners: PartnerPerformance[] }

export function PartnerOperations({ partners }: Props) {
  const columns = [
    { key: 'partner', label: 'Partner' },
    { key: 'corridor', label: 'Corridor' },
    { key: 'completed', label: 'Completed', align: 'right' as const, render: (r: PartnerPerformance) => Number(r.completed).toLocaleString() },
    { key: 'failure_rate_pct', label: 'Fail %', align: 'right' as const, render: (r: PartnerPerformance) => <span className="text-tier-critical">{parseFloat(r.failure_rate_pct).toFixed(1)}%</span> },
    { key: 'avg_delivery_min', label: 'Avg Delivery', align: 'right' as const, render: (r: PartnerPerformance) => `${parseFloat(r.avg_delivery_min).toFixed(0)} min` },
  ]

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Partner Operations</div>
      <DataTable<PartnerPerformance> columns={columns} data={partners} emptyMessage="No partner data" />
    </Card>
  )
}
