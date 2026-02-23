import { useEffect } from 'react'
import { useDrawer } from '../hooks/useDrawer'
import { useUser360 } from '../hooks/useUser360'
import { Spinner } from '../components/ui/Spinner'
import { Badge } from '../components/ui/Badge'
import { tierColor } from '../services/formatters'
import { AiDossier } from './AiDossier'
import { UserStatsGrid } from './UserStatsGrid'
import { ShapDrivers } from './ShapDrivers'
import { SentimentPanel } from './SentimentPanel'
import { RiskReasons } from './RiskReasons'
import { InterventionRecommendation } from './InterventionRecommendation'
import { TransactionHistory } from './TransactionHistory'
import { EventTimeline } from './EventTimeline'
import { RiskTrendChart } from './RiskTrendChart'
import { ActionButtons } from './ActionButtons'
import { LlmRiskPanel } from './LlmRiskPanel'

export function User360Drawer() {
  const { isOpen, selectedUser, closeDrawer } = useDrawer()
  const { dossier, transactions, sentiment, loading } = useUser360(selectedUser?.user_id || null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDrawer()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, closeDrawer])

  if (!isOpen || !selectedUser) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-[4px] z-[100]" onClick={closeDrawer} />
      <div className="fixed right-0 top-0 bottom-0 w-[600px] bg-white border-l border-border z-[101] overflow-y-auto shadow-[-8px_0_32px_rgba(30,10,78,0.1)] animate-slide-in-right">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-[17px] font-bold tracking-tight">{selectedUser.user_id}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge label={selectedUser.risk_tier} tier={selectedUser.risk_tier} />
                <span className="text-sm font-semibold" style={{ color: tierColor(selectedUser.risk_tier) }}>
                  {((selectedUser.churn_probability || 0) * 100).toFixed(0)}% risk
                </span>
              </div>
            </div>
            <button onClick={closeDrawer} className="text-text-tertiary hover:text-text-primary text-xl transition-colors">x</button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20"><Spinner className="w-8 h-8" /></div>
          ) : (
            <div className="space-y-4">
              <AiDossier dossier={dossier} />
              <UserStatsGrid user={selectedUser} dossier={dossier} />
              <ShapDrivers drivers={dossier?.shap_drivers || []} />
              <SentimentPanel sentiment={sentiment || dossier?.sentiment || null} />
              <RiskReasons reasons={dossier?.churn_reasons || selectedUser.reasons || []} />
              <InterventionRecommendation dossier={dossier} user={selectedUser} />
              <LlmRiskPanel dossier={dossier} />
              <RiskTrendChart userId={selectedUser.user_id} />
              <TransactionHistory transactions={transactions} />
              <EventTimeline timeline={dossier?.timeline || []} />
              <ActionButtons user={selectedUser} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
