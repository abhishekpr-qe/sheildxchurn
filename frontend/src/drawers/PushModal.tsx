import { useState } from 'react'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { api } from '../services/api-client'

interface Props { open: boolean; onClose: () => void; userId: string }

export function PushModal({ open, onClose, userId }: Props) {
  const [title, setTitle] = useState('Vance')
  const [message, setMessage] = useState('')
  const [image, setImage] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (!message.trim()) return
    setSending(true)
    try {
      await api.post('/api/moengage/engage', {
        user_id: userId,
        title,
        message: message.trim(),
        richImage: image || undefined,
      })
      onClose()
    } catch {
      // error handled silently
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Send Push Notification">
      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-tight block mb-1">Title</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Notification title" />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-tight block mb-1">Message</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Enter push message (required)"
            className="w-full px-3 py-2 rounded-[10px] border border-border bg-white text-text-primary text-xs tracking-tight outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-text-tertiary resize-y min-h-[60px]"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-tight block mb-1">Rich Image URL (optional)</label>
          <Input value={image} onChange={e => setImage(e.target.value)} placeholder="https://..." />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSend} disabled={sending || !message.trim()}>
          {sending ? <Spinner className="w-3 h-3" /> : 'Send Push'}
        </Button>
      </div>
    </Modal>
  )
}
