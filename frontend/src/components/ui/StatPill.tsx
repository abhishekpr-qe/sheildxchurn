interface StatPillProps {
  label: string
  value: string
  color?: string
}

export function StatPill({ label, value, color }: StatPillProps) {
  return (
    <div className="bg-surface-1 border border-border rounded-[10px] px-3.5 py-2 min-w-[100px] hover:border-border-hover transition-colors">
      <div className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight">{label}</div>
      <div className="text-xl font-bold tracking-[-1.5px]" style={color ? { color } : undefined}>{value}</div>
    </div>
  )
}
