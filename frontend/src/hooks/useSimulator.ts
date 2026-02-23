import { useState, useCallback } from 'react'
import type { SimulationResult } from '../types'
import { api } from '../services/api-client'

interface SimParams {
  cohort_key?: string
  playbook?: string
  budget?: number
  target_count?: number
}

export function useSimulator() {
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const simulate = useCallback(async (params: SimParams) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.post<SimulationResult>('/api/simulator', params)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setLoading(false)
    }
  }, [])

  return { result, loading, error, simulate }
}
