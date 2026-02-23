import { Card } from '../../components/ui/Card'
import { BarChart } from '../../components/charts/BarChart'
import type { ShapResponse } from '../../types/api'

interface Props { shap: ShapResponse | null }

export function GlobalShap({ shap }: Props) {
  if (!shap?.feature_importance) {
    return (
      <Card>
        <div className="text-[15px] font-semibold tracking-tight mb-3.5">Global SHAP Importance</div>
        <div className="text-center py-10 text-text-tertiary text-sm">No SHAP data</div>
      </Card>
    )
  }

  const entries = Object.entries(shap.feature_importance)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 12)

  const categories = entries.map(([k]) => k.replace(/_/g, ' '))
  const values = entries.map(([, v]) => Math.abs(v))
  const series = [{ name: 'SHAP Value', data: values }]

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Global SHAP Importance</div>
      <BarChart categories={categories} series={series} horizontal colors={['#7C57CC']} height={320} />
      <div className="flex gap-4 mt-2 text-[10px] text-text-tertiary">
        <span><span className="inline-block w-2 h-2 rounded-full bg-tier-critical mr-1" />Increases churn</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-tier-low mr-1" />Decreases churn</span>
      </div>
    </Card>
  )
}
