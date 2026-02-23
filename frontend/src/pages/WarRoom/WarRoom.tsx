import { useDashboardData } from '../../hooks/useDashboardData'
import { Spinner } from '../../components/ui/Spinner'
import { LivePulseStrip } from './LivePulseStrip'
import { IntegrationArchitecture } from './IntegrationArchitecture'
import { KpiGrid } from './KpiGrid'
import { MonthlyTrends } from './MonthlyTrends'
import { TransactionHealth } from './TransactionHealth'
import { PartnerOperations } from './PartnerOperations'
import { ChurnReasons } from './ChurnReasons'
import { CorridorPerformance } from './CorridorPerformance'
import { ModelPerformance } from './ModelPerformance'

export function WarRoom() {
  const { data, executive, integrations, model, loading } = useDashboardData()

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner className="w-8 h-8" /></div>
  }

  return (
    <div className="space-y-3.5">
      <LivePulseStrip />
      <IntegrationArchitecture integrations={integrations} />
      <KpiGrid executive={executive} />
      <div className="grid grid-cols-2 gap-3.5">
        <MonthlyTrends trends={data?.monthly_trends || []} />
        <TransactionHealth status={data?.transaction_status || {}} />
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <ChurnReasons overview={data?.churn_overview || { status: {}, tiers: {} }} />
        <CorridorPerformance corridors={data?.corridor_analysis || {}} />
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <PartnerOperations partners={data?.partner_performance || []} />
        <ModelPerformance model={model} />
      </div>
    </div>
  )
}
