import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

export interface EmergencyStopState {
  stopped: boolean
  stoppedAt: number | null
  reason: string
}

export interface EmergencyStopAPI {
  state: EmergencyStopState
  trigger: (reason?: string) => void
  reset: () => void
  registerLoop: (abort: () => void) => () => void
}

export const EmergencyStopContext = createContext<EmergencyStopAPI | null>(null)

export function EmergencyStopProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EmergencyStopState>({
    stopped: false,
    stoppedAt: null,
    reason: '',
  })

  const loopsRef = useRef<Set<() => void>>(new Set())

  const trigger = useCallback((reason = '') => {
    setState(prev => {
      if (prev.stopped) return prev
      return { stopped: true, stoppedAt: Date.now(), reason }
    })
    const loops = loopsRef.current
    for (const abort of loops) {
      try { abort() } catch { /* ignore */ }
    }
  }, [])

  const reset = useCallback(() => {
    setState({ stopped: false, stoppedAt: null, reason: '' })
  }, [])

  const registerLoop = useCallback((abort: () => void): (() => void) => {
    loopsRef.current.add(abort)
    return () => {
      loopsRef.current.delete(abort)
    }
  }, [])

  return React.createElement(
    EmergencyStopContext.Provider,
    { value: { state, trigger, reset, registerLoop } },
    children
  )
}

export function useEmergencyStop(): EmergencyStopAPI {
  const ctx = useContext(EmergencyStopContext)
  if (!ctx) {
    throw new Error('useEmergencyStop must be used within EmergencyStopProvider')
  }
  return ctx
}
