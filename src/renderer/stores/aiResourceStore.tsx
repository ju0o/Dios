import { createContext, useCallback, useContext, useState, useEffect } from 'react'

interface AIResource {
  id: string
  name: string
  provider: string
  monthlyCap: number
  estimatedCost: number
  status: 'normal' | 'warning' | 'hard_stop'
  createdAt: number
  updatedAt: number
}

interface AIResourceContextType {
  resources: AIResource[]
  loading: boolean
  refresh: () => Promise<void>
}

const AIResourceContext = createContext<AIResourceContextType | null>(null)

export function AIResourceProvider({ children }: { children: React.ReactNode }) {
  const [resources, setResources] = useState<AIResource[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await (window as any).electronAPI.listAIResources()
      if (result?.ok) {
        setResources(result.data)
      }
    } catch (error) {
      console.error('AI 리소스 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <AIResourceContext.Provider value={{ resources, loading, refresh }}>
      {children}
    </AIResourceContext.Provider>
  )
}

export function useAIResources() {
  const context = useContext(AIResourceContext)
  if (!context) {
    throw new Error('useAIResources must be used within AIResourceProvider')
  }
  return context
}
