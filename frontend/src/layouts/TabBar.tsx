import { useNavigate, useLocation } from 'react-router-dom'
import { TABS } from '../config/constants'

export function TabBar() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="flex gap-0.5 bg-white rounded-xl p-[3px] border border-border mx-8 mt-3.5 shadow-[0_1px_3px_rgba(30,10,78,0.06)]">
      {TABS.map(tab => {
        const active = location.pathname === tab.path
        return (
          <button
            key={tab.key}
            onClick={() => navigate(tab.path)}
            className={`px-[18px] py-2 rounded-[10px] text-xs font-semibold tracking-tight transition-all ${
              active
                ? 'bg-gradient-to-br from-[#3B1B8C] to-[#5523B2] text-white shadow-[0_2px_12px_rgba(85,35,178,0.25)]'
                : 'text-text-tertiary hover:text-text-primary hover:bg-surface-2'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
