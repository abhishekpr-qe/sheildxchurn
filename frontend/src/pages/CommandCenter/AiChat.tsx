import { useState, useRef, useEffect } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { api } from '../../services/api-client'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Which users are most likely to churn this week?',
  'What are the top churn drivers?',
  'Recommend a retention strategy for high-risk users',
  'Summarize corridor performance',
]

export function AiChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  async function send(text: string) {
    if (!text.trim()) return
    const userMsg: Message = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await api.post<{ response: string }>('/api/ai/chat', { message: text.trim() })
      setMessages(prev => [...prev, { role: 'assistant', content: res.response }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e instanceof Error ? e.message : 'Failed'}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <div className="text-[15px] font-semibold tracking-tight mb-3.5">AI Command Chat</div>
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => send(s)}
              className="text-[11px] px-3 py-1.5 rounded-full border border-border text-text-secondary hover:border-accent hover:text-accent transition-all tracking-tight"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div ref={chatRef} className="space-y-2 max-h-[400px] overflow-y-auto mb-4">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[80%] px-3.5 py-2.5 rounded-xl text-[13px] leading-[1.4] tracking-tight ${
            m.role === 'user'
              ? 'ml-auto bg-gradient-to-br from-[#5523B2] to-[#7C57CC] text-white rounded-br-sm'
              : 'bg-surface-2 border border-border text-text-primary rounded-bl-sm'
          }`}>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-text-tertiary text-xs px-3.5 py-2.5">
            <Spinner className="w-3 h-3" /> Thinking...
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Ask about churn, users, corridors..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !loading) send(input) }}
        />
        <Button onClick={() => send(input)} disabled={loading || !input.trim()}>Send</Button>
      </div>
    </Card>
  )
}
