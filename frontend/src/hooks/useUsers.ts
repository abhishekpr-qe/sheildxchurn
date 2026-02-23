import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '../types'
import { api } from '../services/api-client'

interface Filters {
  search: string
  tier: string
  corridor: string
  sort: string
}

export function useUsers(filters: Filters) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const fetch = useCallback(async (f: Filters) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.search) params.set('search', f.search)
      if (f.tier && f.tier !== 'ALL') params.set('tier', f.tier)
      if (f.corridor && f.corridor !== 'ALL') params.set('corridor', f.corridor)
      if (f.sort) params.set('sort', f.sort)
      params.set('limit', '500')
      const data = await api.get<User[]>(`/api/users?${params}`)
      setUsers(data)
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fetch(filters), 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [filters.search, filters.tier, filters.corridor, filters.sort, fetch])

  return { users, loading }
}
