import { useState, useEffect } from 'react'
import type { Dossier, Transaction, SentimentData } from '../types'
import { api } from '../services/api-client'

interface User360Data {
  dossier: Dossier | null
  transactions: Transaction[]
  sentiment: SentimentData | null
  loading: boolean
  error: string | null
}

export function useUser360(userId: string | null) {
  const [state, setState] = useState<User360Data>({
    dossier: null, transactions: [], sentiment: null, loading: false, error: null,
  })

  useEffect(() => {
    if (!userId) {
      setState({ dossier: null, transactions: [], sentiment: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    Promise.all([
      api.get<Dossier>(`/api/users/${userId}/dossier`).catch(() => null),
      api.get<Transaction[]>(`/api/users/${userId}/transactions`).catch(() => []),
      api.get<SentimentData>(`/api/users/${userId}/sentiment`).catch(() => null),
    ]).then(([dossier, transactions, sentiment]) => {
      if (!cancelled) {
        setState({ dossier, transactions, sentiment, loading: false, error: null })
      }
    }).catch(e => {
      if (!cancelled) setState({ dossier: null, transactions: [], sentiment: null, loading: false, error: e.message })
    })

    return () => { cancelled = true }
  }, [userId])

  return state
}
