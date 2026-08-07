import { useEffect, useState } from 'react'

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

interface UsageRecord {
  id: string
  resourceId: string
  cost: number
  createdAt: number
}

const STATUS_COLORS = {
  normal: 'bg-green-600',
  warning: 'bg-yellow-600',
  hard_stop: 'bg-red-600',
}

const STATUS_LABELS = {
  normal: '정상',
  warning: '경고',
  hard_stop: '정지',
}

export function AIResourceView() {
  const [resources, setResources] = useState<AIResource[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedResource, setSelectedResource] = useState<AIResource | null>(null)
  const [usageHistory, setUsageHistory] = useState<UsageRecord[]>([])

  useEffect(() => {
    loadResources()
  }, [])

  async function loadResources() {
    try {
      const result = await (window as any).electronAPI.listAIResources()
      if (result.ok) {
        setResources(result.data)
      }
    } catch (error) {
      console.error('리소스 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(name: string, provider: string, monthlyCap: number) {
    try {
      const result = await (window as any).electronAPI.createAIResource({
        name,
        provider,
        monthlyCap,
      })
      if (result.ok) {
        await loadResources()
        setShowCreateModal(false)
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('리소스 생성 실패:', error)
    }
  }

  async function handleRecordUsage(resourceId: string, cost: number) {
    try {
      const result = await (window as any).electronAPI.recordAIUsage({
        resourceId,
        cost,
      })
      if (result.ok) {
        await loadResources()
        if (selectedResource?.id === resourceId) {
          await loadUsageHistory(resourceId)
        }
        if (result.data.hardStopTriggered) {
          alert('⚠️ 하드 스톱 도달! 리소스가 정지되었습니다.')
        } else if (result.data.softWarningTriggered) {
          alert('⚡ 경고: 비용이 임계값의 80%를 초과했습니다.')
        }
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('사용량 기록 실패:', error)
    }
  }

  async function handleResetMonthly(resourceId: string) {
    if (!confirm('이번 달 사용량을 초기화하시겠습니까?')) return
    try {
      const result = await (window as any).electronAPI.resetMonthlyUsage(resourceId)
      if (result.ok) {
        await loadResources()
        if (selectedResource?.id === resourceId) {
          await loadUsageHistory(resourceId)
        }
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('월초 리셋 실패:', error)
    }
  }

  async function loadUsageHistory(resourceId: string) {
    try {
      const result = await (window as any).electronAPI.getUsageHistory(resourceId)
      if (result.ok) {
        setUsageHistory(result.data)
      }
    } catch (error) {
      console.error('사용량 이력 로드 실패:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">⬢ AI 리소스 관리</h1>
          <p className="text-gray-400">비용을 추적하고 한도를 관리하세요</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg text-sm font-medium transition-all"
        >
          + 새 리소스
        </button>
      </div>

      {resources.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center text-gray-500">
          AI 리소스가 없습니다. 새 리소스를 추가하세요.
        </div>
      ) : (
        <div className="grid gap-4">
          {resources.map((resource) => {
            const usagePercent = resource.monthlyCap > 0 ? (resource.estimatedCost / resource.monthlyCap) * 100 : 0
            return (
              <div
                key={resource.id}
                className="glass rounded-xl p-6 hover:border-white/20 transition-all cursor-pointer"
                onClick={() => {
                  setSelectedResource(resource)
                  loadUsageHistory(resource.id)
                }}
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-semibold">{resource.name}</h3>
                      <span className={`px-2 py-1 rounded text-xs font-medium text-white ${STATUS_COLORS[resource.status]}`}>
                        {STATUS_LABELS[resource.status]}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">Provider: {resource.provider}</p>
                  </div>
                </div>

                {/* Usage Bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">사용량</span>
                    <span className="font-mono">
                      ${resource.estimatedCost.toFixed(2)} / ${resource.monthlyCap.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        usagePercent >= 100 ? 'bg-red-600' : usagePercent >= 80 ? 'bg-yellow-600' : 'bg-green-600'
                      }`}
                      style={{ width: `${Math.min(usagePercent, 100)}%` }}
                    />
                  </div>
                  <div className="text-right text-xs text-gray-500 mt-1">{usagePercent.toFixed(1)}%</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateResourceModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Detail Modal */}
      {selectedResource && (
        <ResourceDetailModal
          resource={selectedResource}
          usageHistory={usageHistory}
          onClose={() => setSelectedResource(null)}
          onRecordUsage={handleRecordUsage}
          onResetMonthly={handleResetMonthly}
        />
      )}
    </div>
  )
}

function CreateResourceModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string, provider: string, monthlyCap: number) => void
}) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('')
  const [monthlyCap, setMonthlyCap] = useState('')

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass-strong rounded-xl max-w-lg w-full p-6">
        <h2 className="text-2xl font-bold mb-6">새 AI 리소스</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="리소스 이름"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Provider</label>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="OpenAI, Anthropic, etc."
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">월 한도 ($)</label>
            <input
              type="number"
              value={monthlyCap}
              onChange={(e) => setMonthlyCap(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="100"
              min="0"
              step="0.01"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
          >
            취소
          </button>
          <button
            onClick={() => onCreate(name, provider, parseFloat(monthlyCap))}
            disabled={!name.trim() || !provider.trim() || !monthlyCap || parseFloat(monthlyCap) <= 0}
            className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
          >
            생성
          </button>
        </div>
      </div>
    </div>
  )
}

function ResourceDetailModal({
  resource,
  usageHistory,
  onClose,
  onRecordUsage,
  onResetMonthly,
}: {
  resource: AIResource
  usageHistory: UsageRecord[]
  onClose: () => void
  onRecordUsage: (resourceId: string, cost: number) => void
  onResetMonthly: (resourceId: string) => void
}) {
  const [showUsageForm, setShowUsageForm] = useState(false)
  const [cost, setCost] = useState('')

  const usagePercent = resource.monthlyCap > 0 ? (resource.estimatedCost / resource.monthlyCap) * 100 : 0

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass-strong rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-white/10 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-bold">{resource.name}</h2>
                <span className={`px-3 py-1 rounded text-sm font-medium text-white ${STATUS_COLORS[resource.status]}`}>
                  {STATUS_LABELS[resource.status]}
                </span>
              </div>
              <p className="text-gray-400">Provider: {resource.provider}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Usage Summary */}
          <div className="glass rounded-xl p-4 mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-gray-400">이번 달 사용량</span>
              <span className="text-2xl font-bold font-mono">${resource.estimatedCost.toFixed(2)}</span>
            </div>
            <div className="h-3 bg-white/5 rounded-full overflow-hidden mb-2">
              <div
                className={`h-full transition-all ${
                  usagePercent >= 100 ? 'bg-red-600' : usagePercent >= 80 ? 'bg-yellow-600' : 'bg-green-600'
                }`}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>{usagePercent.toFixed(1)}% 사용</span>
              <span>한도: ${resource.monthlyCap.toFixed(2)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mb-6">
            {!showUsageForm ? (
              <>
                <button
                  onClick={() => setShowUsageForm(true)}
                  disabled={resource.status === 'hard_stop'}
                  className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
                >
                  사용량 기록
                </button>
                <button
                  onClick={() => onResetMonthly(resource.id)}
                  className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
                >
                  월초 리셋
                </button>
              </>
            ) : (
              <div className="flex-1 glass rounded-xl p-4">
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
                    placeholder="비용 ($)"
                    min="0"
                    step="0.01"
                  />
                  <button
                    onClick={() => {
                      onRecordUsage(resource.id, parseFloat(cost))
                      setShowUsageForm(false)
                      setCost('')
                    }}
                    disabled={!cost || parseFloat(cost) <= 0}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
                  >
                    기록
                  </button>
                  <button
                    onClick={() => {
                      setShowUsageForm(false)
                      setCost('')
                    }}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Usage History */}
          <div>
            <h3 className="text-lg font-semibold mb-3">사용 이력</h3>
            {usageHistory.length === 0 ? (
              <div className="text-gray-500 text-sm">사용 이력이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {usageHistory.map((usage) => (
                  <div key={usage.id} className="glass rounded-lg p-3 flex items-center justify-between">
                    <span className="text-sm text-gray-400">
                      {new Date(usage.createdAt).toLocaleString('ko-KR')}
                    </span>
                    <span className="font-mono font-semibold">${usage.cost.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
