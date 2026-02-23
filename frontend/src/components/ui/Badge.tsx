import { tierBg } from '../../services/formatters'

interface BadgeProps {
  label: string
  tier?: string
  className?: string
}

export function Badge({ label, tier, className = '' }: BadgeProps) {
  const colors = tier
    ? tierBg(tier)
    : 'bg-accent/10 text-accent-light border-accent/30'

  return (
    <span className={`inline-block px-2 py-[3px] rounded-md text-[10px] font-semibold tracking-tight border ${colors} ${className}`}>
      {label}
    </span>
  )
}
