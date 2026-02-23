import { createContext, useContext, useState, useCallback } from 'react'
import type { DashboardData, Executive, Integrations, ModelInfo, Cohort } from '../types'
import type { ShapResponse } from '../types/api'
import { api } from '../services/api-client'

export interface DashboardState {
  data: DashboardData | null
  executive: Executive | null
  integrations: Integrations | null
  model: ModelInfo | null
  cohorts: Cohort[]
  shap: ShapResponse | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  fetchAll: () => Promise<void>
}

const defaultState: DashboardState = {
  data: null,
  executive: null,
  integrations: null,
  model: null,
  cohorts: [],
  shap: null,
  loading: true,
  error: null,
  refresh: async () => {},
  fetchAll: async () => {},
}

export const DashboardDataContext = createContext<DashboardState>(defaultState)

export function useDashboardData() {
  return useContext(DashboardDataContext)
}

export function useDashboardDataProvider() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [executive, setExecutive] = useState<Executive | null>(null)
  const [integrations, setIntegrations] = useState<Integrations | null>(null)
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [shap, setShap] = useState<ShapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [d, ex, intg, m, c, sh] = await Promise.all([
        api.get<DashboardData>('/api/data'),
        api.get<Executive>('/api/executive'),
        api.get<Integrations>('/api/integrations').catch(() => null),
        api.get<ModelInfo>('/api/model').catch(() => null),
        api.get<Cohort[]>('/api/cohorts').catch(() => []),
        api.get<ShapResponse>('/api/shap').catch(() => null),
      ])
      setData(d)
      setExecutive(ex)
      setIntegrations(intg)
      setModel(m)
      setCohorts(c)
      setShap(sh)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await api.post('/api/refresh')
    await fetchAll()
  }, [fetchAll])

  return { data, executive, integrations, model, cohorts, shap, loading, error, refresh, fetchAll }
}
