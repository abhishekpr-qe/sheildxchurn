import { Card } from '../../components/ui/Card'
import { TierDistributionBar } from '../../components/charts/TierDistributionBar'
import type { User } from '../../types'

interface Props { users: User[] }

export function TierDistribution({ users }: Props) {
  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">Risk Tier Distribution</div>
      <TierDistributionBar users={users} />
      <div className="text-xs text-text-tertiary mt-1">{users.length} total users scored</div>
    </Card>
  )
}
