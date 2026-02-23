import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { api } from '../services/api-client'
import { PushModal } from './PushModal'
import type { User } from '../types'

interface Props { user: User }

export function ActionButtons({ user }: Props) {
  const [pushOpen, setPushOpen] = useState(false)
  const [calling, setCalling] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [status, setStatus] = useState('')

  async function handleCall() {
    setCalling(true)
    try {
      await api.post('/api/retell/call', { user_id: user.user_id })
      setStatus('Call initiated')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Call failed')
    } finally {
      setCalling(false)
    }
  }

  async function handleAnalysis() {
    setAnalyzing(true)
    try {
      await api.post('/api/ai/risk-analysis', { user_id: user.user_id })
      setStatus('Analysis complete')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div>
      <div className="text-xs font-semibold tracking-tight mb-2">Actions</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setPushOpen(true)}>Push Notification</Button>
        <Button size="sm" variant="outline" onClick={handleCall} disabled={calling}>
          {calling ? <Spinner className="w-3 h-3" /> : 'AI Call'}
        </Button>
        <Button size="sm" variant="outline" onClick={handleAnalysis} disabled={analyzing}>
          {analyzing ? <Spinner className="w-3 h-3" /> : 'Risk Analysis'}
        </Button>
      </div>
      {status && <div className="text-[10px] text-text-tertiary mt-2">{status}</div>}
      <PushModal open={pushOpen} onClose={() => setPushOpen(false)} userId={user.user_id} />
    </div>
  )
}
