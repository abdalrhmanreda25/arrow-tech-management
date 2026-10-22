'use client'

import { createContext, useContext, type ReactNode } from 'react'
import Toast, { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'

interface ToastValue {
  success: (text: string) => void
  error: (err: unknown) => void
}

const ToastContext = createContext<ToastValue | null>(null)

export function useToaster() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToaster must be used inside <ToastProvider>')
  return ctx
}

export default function ToastProvider({ children }: { children: ReactNode }) {
  const { toast, show, dismiss } = useToast(4500)
  const value: ToastValue = {
    success: (text) => show('success', text),
    error: (err) => show('error', typeof err === 'string' ? err : friendlyError(err)),
  }
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast toast={toast} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
