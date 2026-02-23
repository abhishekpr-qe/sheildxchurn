import { useDashboardData } from '../../hooks/useDashboardData'
import { useSimulator } from '../../hooks/useSimulator'
import { Spinner } from '../../components/ui/Spinner'
import { SimulatorControls } from './SimulatorControls'
import { SimulationResults } from './SimulationResults'
import { GlobalShap } from './GlobalShap'
import { PerUserShap } from './PerUserShap'

export function Simulator() {
  const { cohorts, shap, loading: dashLoading } = useDashboardData()
  const simulator = useSimulator()

  if (dashLoading) {
    return <div className="flex items-center justify-center py-20"><Spinner className="w-8 h-8" /></div>
  }

  return (
    <div className="space-y-3.5">
      <SimulatorControls cohorts={cohorts} onSimulate={simulator.simulate} loading={simulator.loading} />
      {simulator.result && <SimulationResults result={simulator.result} />}
      {simulator.error && (
        <div className="bg-tier-critical/10 border border-tier-critical/30 rounded-[14px] p-4 text-sm text-tier-critical">{simulator.error}</div>
      )}
      <div className="grid grid-cols-2 gap-3.5">
        <GlobalShap shap={shap} />
        <PerUserShap shap={shap} />
      </div>
    </div>
  )
}
