import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ToastData {
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastCtx {
  show: (message: string, type?: ToastData['type']) => void
}

export const ToastContext = createContext<ToastCtx>({ show: () => {} })
export function useToast() { return useContext(ToastContext) }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null)

  const show = useCallback((message: string, type: ToastData['type'] = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && <ToastNotification toast={toast} />}
    </ToastContext.Provider>
  )
}

function ToastNotification({ toast }: { toast: ToastData }) {
  const colors = {
    success: 'border-tier-low/30',
    error: 'border-tier-critical/30',
    info: 'border-accent/30',
  }
  return (
    <div className={`fixed bottom-6 right-6 bg-surface-1 border ${colors[toast.type]} rounded-[14px] px-6 py-4 z-[200] max-w-[380px] shadow-[0_12px_40px_rgba(30,10,78,0.12)] animate-slide-up`}>
      <p className="text-sm text-text-primary">{toast.message}</p>
    </div>
  )
}

export function Toast() {
  return null
}
