import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { PLAYBOOKS } from '../../config/constants'
import type { Cohort } from '../../types'

interface Props {
  cohorts: Cohort[]
  onSimulate: (params: { cohort_key?: string; playbook?: string; budget?: number; target_count?: number }) => void
  loading: boolean
}

export function SimulatorControls({ cohorts, onSimulate, loading }: Props) {
  const [cohortKey, setCohortKey] = useState('')
  const [playbook, setPlaybook] = useState('')
  const [budget, setBudget] = useState('')
  const [target, setTarget] = useState('')

  function handleRun() {
    onSimulate({
      cohort_key: cohortKey || undefined,
      playbook: playbook || undefined,
      budget: budget ? Number(budget) : undefined,
      target_count: target ? Number(target) : undefined,
    })
  }

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-4">Simulation Parameters</div>
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight block mb-1">Cohort</label>
          <Select value={cohortKey} onChange={e => setCohortKey(e.target.value)}>
            <option value="">All Users</option>
            {cohorts.map(c => <option key={c.key} value={c.key}>{c.label} ({c.count})</option>)}
          </Select>
        </div>
        <div>
          <label className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight block mb-1">Playbook</label>
          <Select value={playbook} onChange={e => setPlaybook(e.target.value)}>
            <option value="">Default</option>
            {PLAYBOOKS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight block mb-1">Budget ($)</label>
          <Input type="number" placeholder="5000" value={budget} onChange={e => setBudget(e.target.value)} className="w-28" />
        </div>
        <div>
          <label className="text-[10px] text-text-tertiary uppercase font-semibold tracking-tight block mb-1">Target Count</label>
          <Input type="number" placeholder="100" value={target} onChange={e => setTarget(e.target.value)} className="w-28" />
        </div>
        <Button onClick={handleRun} disabled={loading}>
          {loading ? 'Running...' : 'Run Simulation'}
        </Button>
      </div>
    </Card>
  )
}
