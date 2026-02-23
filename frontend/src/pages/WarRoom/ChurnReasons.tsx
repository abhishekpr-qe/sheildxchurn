import { Card } from '../../components/ui/Card'
import { BarChart } from '../../components/charts/BarChart'
import { TIER_COLORS } from '../../config/theme'
import type { ChurnOverview } from '../../types'

const TIER_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const

interface Props { overview: ChurnOverview }

export function ChurnReasons({ overview }: Props) {
  const tiers = overview.tiers ?? {}
  const entries = TIER_ORDER.filter((t) => t in tiers).map((t) => [t, tiers[t]] as const)
  const categories = entries.map(([k]) => k)
  const colors = entries.map(([k]) => TIER_COLORS[k as keyof typeof TIER_COLORS])
  const series = [{ name: 'Users', data: entries.map(([, v]) => v) }]

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Risk Tier Breakdown</div>
      {entries.length > 0 ? (
        <BarChart categories={categories} series={series} horizontal colors={colors} height={280} />
      ) : (
        <div className="text-center py-10 text-text-tertiary text-sm">No tier data</div>
      )}
    </Card>
  )
}
