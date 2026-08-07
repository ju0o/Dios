import { createContext, useCallback, useContext, useState, useEffect } from 'react'

interface HumanGateConfig {
  id: string
  level: 'COMPANY' | 'FINANCE' | 'AI_RESOURCE' | 'GOVERNANCE'
  name: string
  description: string
  softThreshold: number
  hardThreshold: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface HumanGateContextType {
  gates: HumanGateConfig[]
  loading: boolean
  refresh: () => Promise<void>
}

const HumanGateContext = createContext<HumanGateContextType | null>(null)

export function HumanGateProvider({ children }: { children: React.ReactNode }) {
  const [gates, setGates] = useState<HumanGateConfig[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await (window as any).electronAPI.listHumanGates()
      if (result?.ok) {
        setGates(result.data)
      }
    } catch (error) {
      console.error('휴먼 게이트 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <HumanGateContext.Provider value={{ gates, loading, refresh }}>
      {children}
    </HumanGateContext.Provider>
  )
}

export function useHumanGates() {
  const context = useContext(HumanGateContext)
  if (!context) {
    throw new Error('useHumanGates must be used within HumanGateProvider')
  }
  return context
}
