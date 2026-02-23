import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'

interface Filters {
  search: string
  tier: string
  corridor: string
  sort: string
}

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  corridors: string[]
}

export function FilterBar({ filters, onChange, corridors }: Props) {
  const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value })

  return (
    <div className="flex gap-3 items-center flex-wrap">
      <Input
        placeholder="Search user ID..."
        value={filters.search}
        onChange={e => set('search', e.target.value)}
        className="w-64"
      />
      <Select value={filters.tier} onChange={e => set('tier', e.target.value)}>
        <option value="ALL">All Tiers</option>
        <option value="CRITICAL">Critical</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
      </Select>
      <Select value={filters.corridor} onChange={e => set('corridor', e.target.value)}>
        <option value="ALL">All Corridors</option>
        {corridors.map(c => <option key={c} value={c}>{c}</option>)}
      </Select>
      <Select value={filters.sort} onChange={e => set('sort', e.target.value)}>
        <option value="">Sort: Risk Score</option>
        <option value="volume">Sort: Volume</option>
        <option value="days">Sort: Days Inactive</option>
      </Select>
    </div>
  )
}
