interface ProgressBarProps {
  label: string
  value: number
  max: number
  color: string
  showValue?: boolean
  formatValue?: (n: number) => string
}

export function ProgressBar({ label, value, max, color, showValue = true, formatValue }: ProgressBarProps) {
  const pct = Math.min((value / max) * 100, 100)
  const display = formatValue ? formatValue(value) : value.toLocaleString()

  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-[3px]">
        <span className="text-text-tertiary">{label}</span>
        {showValue && <span className="font-bold text-text-primary">{display}</span>}
      </div>
      <div className="h-[18px] bg-surface-2 rounded-[9px] overflow-hidden">
        <div
          className="h-full rounded-[9px] transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}
