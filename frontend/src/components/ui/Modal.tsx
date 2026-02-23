import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-[4px] z-[200] flex items-center justify-center" onClick={onClose}>
      <div className="bg-white border border-border rounded-[14px] p-6 w-[400px] max-w-[90vw] shadow-[0_8px_32px_rgba(30,10,78,0.12)]" onClick={e => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold tracking-tight mb-4">{title}</h3>
        {children}
      </div>
    </div>
  )
}
