import { useState } from 'react'
import { useDashboardData } from '../../hooks/useDashboardData'
import { useUsers } from '../../hooks/useUsers'
import { Spinner } from '../../components/ui/Spinner'
import { TierDistribution } from './TierDistribution'
import { FilterBar } from './FilterBar'
import { RiskTable } from './RiskTable'

export function RiskExplorer() {
  const { data, loading: dashLoading } = useDashboardData()
  const [filters, setFilters] = useState({ search: '', tier: 'ALL', corridor: 'ALL', sort: '' })
  const { users, loading } = useUsers(filters)

  const allUsers = [
    ...(data?.at_risk_users || []),
    ...(data?.churned_sample || []),
    ...(data?.healthy_sample || []),
  ]

  if (dashLoading) {
    return <div className="flex items-center justify-center py-20"><Spinner className="w-8 h-8" /></div>
  }

  const corridors = [...new Set(allUsers.map(u => u.corridor).filter(Boolean))]

  return (
    <div className="space-y-3.5">
      <TierDistribution users={allUsers} />
      <FilterBar filters={filters} onChange={setFilters} corridors={corridors} />
      <RiskTable users={users.length > 0 ? users : allUsers} loading={loading} />
    </div>
  )
}
