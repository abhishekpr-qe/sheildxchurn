import { useState } from 'react'
import { useDashboardData } from '../hooks/useDashboardData'

export function Header() {
  const { refresh, loading } = useDashboardData()
  const [fetching, setFetching] = useState(false)

  async function handleFetch() {
    setFetching(true)
    try {
      await refresh()
    } finally {
      setFetching(false)
    }
  }

  return (
    <header className="px-8 py-4 flex justify-between items-center bg-gradient-to-r from-[#1E0A4E] via-[#3B1B8C] to-[#5523B2] sticky top-0 z-50 shadow-[0_4px_24px_rgba(30,10,78,0.2)]">
      <div className="flex items-center gap-3.5">
        <div className="text-[22px] font-bold text-white tracking-tight">
          aspora
        </div>
        <div className="w-px h-6 bg-white/20" />
        <div>
          <div className="text-[15px] font-semibold text-white tracking-tight leading-tight">Churn Intelligence</div>
          <div className="text-[10px] text-white/50 tracking-tight">
            {loading ? 'Loading...' : 'ShieldX Platform'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="px-3.5 py-1.5 rounded-[10px] border border-white/20 text-white/80 text-[11px] font-semibold tracking-tight hover:bg-white/10 hover:text-white transition-all disabled:opacity-50"
        >
          {fetching ? 'Fetching...' : 'Fetch Data'}
        </button>
        <span className="w-2 h-2 rounded-full bg-[#4ADE80] shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse-live" />
        <span className="text-xs text-[#4ADE80] font-semibold tracking-tight">LIVE</span>
      </div>
    </header>
  )
}
