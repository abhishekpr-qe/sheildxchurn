import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api-client'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T>(path: string | null) {
  const [state, setState] = useState<UseApiState<T>>({ data: null, loading: !!path, error: null })

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    api.get<T>(path)
      .then(data => { if (!cancelled) setState({ data, loading: false, error: null }) })
      .catch(e => { if (!cancelled) setState({ data: null, loading: false, error: e.message }) })
    return () => { cancelled = true }
  }, [path])

  return state
}

export function useMutation<TReq, TRes>(path: string) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutate = useCallback(async (body?: TReq): Promise<TRes | null> => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<TRes>(path, body)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      setLoading(false)
    }
  }, [path])

  return { mutate, loading, error }
}
