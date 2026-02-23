export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '-'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.round(n).toString()
}

export function fmtPercent(n: number | null | undefined): string {
  if (n == null) return '-'
  return (n * 100).toFixed(1) + '%'
}

export function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '-'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + Math.round(n).toString()
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtTimeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function tierColor(tier: string): string {
  const colors: Record<string, string> = {
    CRITICAL: '#DC2626',
    HIGH: '#D97706',
    MEDIUM: '#4F46E5',
    LOW: '#16A34A',
  }
  return colors[tier] || '#9B8EC4'
}

export function tierBg(tier: string): string {
  const bgs: Record<string, string> = {
    CRITICAL: 'bg-red-600/10 text-red-700 border-red-600/20',
    HIGH: 'bg-amber-600/10 text-amber-700 border-amber-600/20',
    MEDIUM: 'bg-indigo-600/10 text-indigo-700 border-indigo-600/20',
    LOW: 'bg-green-600/10 text-green-700 border-green-600/20',
  }
  return bgs[tier] || 'bg-zinc-500/10 text-zinc-600 border-zinc-500/20'
}

export function sentimentColor(s: string): string {
  if (s === 'negative') return '#DC2626'
  if (s === 'positive') return '#16A34A'
  return '#9B8EC4'
}
