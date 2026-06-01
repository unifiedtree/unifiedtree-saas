import React, { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import type { Toast } from '@/types'

interface ToastContextType {
  toast: (message: string, type: Toast['type']) => void
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} })

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, type: Toast['type']) => {
    const id = Date.now().toString()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  const icons: Record<Toast['type'], React.ReactNode> = {
    success: <CheckCircle size={15} className="text-emerald-400 flex-shrink-0" />,
    error: <XCircle size={15} className="text-red-400 flex-shrink-0" />,
    info: <Info size={15} className="text-blue-400 flex-shrink-0" />,
    warning: <AlertTriangle size={15} className="text-amber-400 flex-shrink-0" />,
  }

  const bgMap: Record<Toast['type'], string> = {
    success: 'border-emerald-500/30',
    error: 'border-red-500/30',
    info: 'border-blue-500/30',
    warning: 'border-amber-500/30',
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-white shadow-2xl pointer-events-auto animate-slide-up ${bgMap[t.type]}`}
            style={{ minWidth: 280, maxWidth: 380 }}
          >
            {icons[t.type]}
            <p className="text-sm text-slate-200 flex-1">{t.message}</p>
            <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="text-[#64748B] hover:text-[#334155]">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
