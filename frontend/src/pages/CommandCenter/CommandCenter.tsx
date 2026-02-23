import { useDashboardData } from '../../hooks/useDashboardData'
import { Spinner } from '../../components/ui/Spinner'
import { TierCampaignGrid } from './TierCampaignGrid'
import { InterventionLog } from './InterventionLog'
import { CampaignHistory } from './CampaignHistory'
import { BudgetControls } from './BudgetControls'
import { InterventionBreakdown } from './InterventionBreakdown'
import { AiChat } from './AiChat'

export function CommandCenter() {
  const { data, loading } = useDashboardData()

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner className="w-8 h-8" /></div>
  }

  const allUsers = [
    ...(data?.at_risk_users || []),
    ...(data?.churned_sample || []),
    ...(data?.healthy_sample || []),
  ]

  return (
    <div className="space-y-3.5">
      <TierCampaignGrid users={allUsers} />
      <div className="grid grid-cols-2 gap-3.5">
        <InterventionLog />
        <InterventionBreakdown users={allUsers} />
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <CampaignHistory />
        <BudgetControls />
      </div>
      <AiChat />
    </div>
  )
}
