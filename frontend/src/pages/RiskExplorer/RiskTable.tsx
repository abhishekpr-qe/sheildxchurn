import { Spinner } from '../../components/ui/Spinner'
import { Card } from '../../components/ui/Card'
import { RiskTableRow } from './RiskTableRow'
import type { User } from '../../types'

interface Props { users: User[]; loading: boolean }

export function RiskTable({ users, loading }: Props) {
  if (loading) {
    return <div className="flex items-center justify-center py-10"><Spinner /></div>
  }

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">
        Risk Explorer <span className="text-text-tertiary text-xs font-normal ml-2">{users.length} users</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['User ID', 'Tier', 'Score', 'Corridor', 'Volume', 'Days Inactive', 'Signals', 'Reason', 'Intervention'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] text-text-tertiary border-b border-border uppercase tracking-tight font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => <RiskTableRow key={u.user_id} user={u} />)}
          </tbody>
        </table>
      </div>
      {users.length === 0 && (
        <div className="text-center py-10 text-text-tertiary text-sm">No users match filters</div>
      )}
    </Card>
  )
}
