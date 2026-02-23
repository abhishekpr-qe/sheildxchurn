import { Card } from './Card'

interface MetricCardProps {
  label: string
  value: string
  subtitle?: string
  color?: string
  glass?: boolean
}

export function MetricCard({ label, value, subtitle, color, glass }: MetricCardProps) {
  return (
    <Card glass={glass}>
      <div className="text-[10px] text-text-tertiary font-semibold uppercase tracking-tight">{label}</div>
      <div className="text-[32px] font-bold tracking-[-1.5px] leading-none mt-1" style={color ? { color } : undefined}>
        {value}
      </div>
      {subtitle && <div className="text-xs text-text-tertiary tracking-tight mt-0.5">{subtitle}</div>}
    </Card>
  )
}
