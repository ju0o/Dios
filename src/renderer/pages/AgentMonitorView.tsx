import { useEffect, useState } from 'react'

interface AgentService {
  id: string
  name: string
  type: string
  apiKey: string
  baseUrl?: string
  monthlyCap: number
  resetDay?: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface AgentUsageSnapshot {
  serviceId: string
  serviceName: string
  type: string
  used: number
  limit: number
  remaining: number
  percent: number
  resetAt: number
  currency: string
  status: 'idle' | 'loading' | 'success' | 'error'
  error?: string
  fetchedAt: number
  daily?: number
  weekly?: number
  monthly?: number
}

interface AgentPetState {
  mood: 'happy' | 'running' | 'sweating' | 'panicking' | 'collapsed' | 'celebrating'
  speed: number
  message: string
}

const SERVICE_TYPES = [
  { value: 'openai', label: 'OpenAI (Codex 포함)' },
  { value: 'openrouter', label: 'OpenRouter (Goose 등)' },
  { value: 'claude_code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex CLI' },
  { value: 'qwen_studio', label: 'Qwen Studio' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'commandcode', label: 'CommandCode' },
  { value: 'goose', label: 'Goose' },
  { value: 'hermes', label: 'Hermes' },
]

export function AgentMonitorView() {
  const [services, setServices] = useState<AgentService[]>([])
  const [snapshots, setSnapshots] = useState<AgentUsageSnapshot[]>([])
  const [petState, setPetState] = useState<AgentPetState>({ mood: 'happy', speed: 1, message: '로딩 중...' })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [fileCounts, setFileCounts] = useState({ skillCount: 0, mdCount: 0 })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      // 서비스 목록
      const servicesResult = await (window as any).electronAPI.listAgentServices()
      if (servicesResult.ok) {
        setServices(servicesResult.data || [])
      }

      // 캐시된 사용량
      const cachedResult = await (window as any).electronAPI.getCachedAgentUsage()
      if (cachedResult.ok && cachedResult.data) {
        setSnapshots(cachedResult.data)
        updatePetState(cachedResult.data)
      }

      // 파일 카운트
      const fileResult = await (window as any).electronAPI.countLocalFiles()
      if (fileResult) {
        setFileCounts(fileResult)
      }
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const result = await (window as any).electronAPI.fetchAllAgentUsage()
      if (result.ok && result.data) {
        setSnapshots(result.data)
        updatePetState(result.data)
      }
    } catch (error) {
      console.error('사용량 갱신 실패:', error)
    } finally {
      setRefreshing(false)
    }
  }

  function updatePetState(snapshots: AgentUsageSnapshot[]) {
    if (snapshots.length === 0) {
      setPetState({ mood: 'happy', speed: 1, message: '등록된 서비스가 없어요!' })
      return
    }

    const maxPercent = Math.max(...snapshots.map(s => s.percent))
    const hasError = snapshots.some(s => s.status === 'error')

    if (maxPercent >= 100) {
      setPetState({ mood: 'collapsed', speed: 0, message: '한도 초과! 리셋까지 좀 쉬게 해줘...' })
    } else if (maxPercent >= 90) {
      setPetState({ mood: 'panicking', speed: 3, message: '⚠️ 거의 다 썼어! 리셋까지 얼마 안 남았어!' })
    } else if (maxPercent >= 70) {
      setPetState({ mood: 'sweating', speed: 2, message: '💦 좀 빡빡해... 속도 올릴게!' })
    } else if (maxPercent >= 40) {
      setPetState({ mood: 'running', speed: 1.5, message: '🚴 달리는 중! 순조로워~' })
    } else if (hasError) {
      setPetState({ mood: 'happy', speed: 1, message: '🔧 일부 서비스 연결 확인 필요' })
    } else {
      setPetState({ mood: 'celebrating', speed: 0.8, message: '🎉 여유로워! 오늘도 굿!' })
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
          <h1 className="text-3xl font-bold mb-2">🤖 Agent Monitor</h1>
          <p className="text-gray-400">구독 AI 서비스 사용량 실시간 추적</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 rounded-lg text-sm font-medium transition-all"
          >
            {refreshing ? '갱신 중...' : '🔄 새로고침'}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
          >
            ⚙️ 서비스 관리
          </button>
        </div>
      </div>

      {/* Agent Pet Widget */}
      <AgentPet petState={petState} />

      {/* File Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="glass rounded-xl p-6">
          <div className="text-sm text-gray-400 mb-2">Skills</div>
          <div className="text-3xl font-bold">{fileCounts.skillCount}</div>
        </div>
        <div className="glass rounded-xl p-6">
          <div className="text-sm text-gray-400 mb-2">Markdown 파일</div>
          <div className="text-3xl font-bold">{fileCounts.mdCount}</div>
        </div>
      </div>

      {/* Service Usage Cards */}
      {snapshots.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center text-gray-500">
          등록된 서비스가 없습니다. ⚙️ 서비스 관리에서 추가하세요.
        </div>
      ) : (
        <div className="grid gap-4">
          {snapshots.map((snapshot) => (
            <ServiceUsageCard key={snapshot.serviceId} snapshot={snapshot} />
          ))}
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <ServiceSettingsModal
          services={services}
          onClose={() => setShowSettings(false)}
          onRefresh={loadData}
        />
      )}
    </div>
  )
}

function AgentPet({ petState }: { petState: AgentPetState }) {
  const moodEmoji = {
    happy: '😊',
    running: '🚴',
    sweating: '😅',
    panicking: '😱',
    collapsed: '💀',
    celebrating: '🎉',
  }

  return (
    <div className="glass rounded-xl p-6 mb-6 flex items-center gap-6">
      <div
        className="text-6xl"
        style={{
          animation: petState.speed > 0 ? `bounce ${1 / petState.speed}s infinite` : 'none',
        }}
      >
        {moodEmoji[petState.mood]}
      </div>
      <div className="flex-1">
        <div className="text-lg font-semibold mb-1">Agent 상태</div>
        <div className="text-gray-400">{petState.message}</div>
      </div>
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
      `}</style>
    </div>
  )
}

function ServiceUsageCard({ snapshot }: { snapshot: AgentUsageSnapshot }) {
  const statusColor = {
    idle: 'bg-gray-600',
    loading: 'bg-blue-600',
    success: 'bg-green-600',
    error: 'bg-red-600',
  }

  const statusLabel = {
    idle: '대기',
    loading: '로딩',
    success: '정상',
    error: '오류',
  }

  const resetDate = snapshot.resetAt > 0 ? new Date(snapshot.resetAt) : null
  const daysUntilReset = resetDate
    ? Math.ceil((resetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div className="glass rounded-xl p-6 hover:border-white/20 transition-all">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-xl font-semibold">{snapshot.serviceName}</h3>
            <span className={`px-2 py-1 rounded text-xs font-medium text-white ${statusColor[snapshot.status]}`}>
              {statusLabel[snapshot.status]}
            </span>
          </div>
          <p className="text-sm text-gray-400">
            {SERVICE_TYPES.find(t => t.value === snapshot.type)?.label || snapshot.type}
          </p>
        </div>
        {snapshot.error && (
          <div className="text-xs text-red-400 max-w-xs text-right">{snapshot.error}</div>
        )}
      </div>

      {/* Usage Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">사용량</span>
          <span className="font-mono">
            {snapshot.used.toFixed(2)} / {snapshot.limit.toFixed(2)} {snapshot.currency}
          </span>
        </div>
        <div className="h-3 bg-white/5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              snapshot.percent >= 100
                ? 'bg-red-600'
                : snapshot.percent >= 80
                ? 'bg-yellow-600'
                : 'bg-green-600'
            }`}
            style={{ width: `${Math.min(snapshot.percent, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{snapshot.percent.toFixed(1)}% 사용</span>
          <span>잔여: {snapshot.remaining.toFixed(2)}</span>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        {snapshot.daily !== undefined && (
          <div>
            <div className="text-gray-500">오늘</div>
            <div className="font-mono">{snapshot.daily.toFixed(2)}</div>
          </div>
        )}
        {snapshot.weekly !== undefined && (
          <div>
            <div className="text-gray-500">이번 주</div>
            <div className="font-mono">{snapshot.weekly.toFixed(2)}</div>
          </div>
        )}
        {snapshot.monthly !== undefined && (
          <div>
            <div className="text-gray-500">이번 달</div>
            <div className="font-mono">{snapshot.monthly.toFixed(2)}</div>
          </div>
        )}
        {daysUntilReset !== null && (
          <div>
            <div className="text-gray-500">리셋까지</div>
            <div className="font-mono">{daysUntilReset}일</div>
          </div>
        )}
      </div>

      {snapshot.fetchedAt > 0 && (
        <div className="text-xs text-gray-600 mt-3">
          마지막 갱신: {new Date(snapshot.fetchedAt).toLocaleString('ko-KR')}
        </div>
      )}
    </div>
  )
}

function ServiceSettingsModal({
  services,
  onClose,
  onRefresh,
}: {
  services: AgentService[]
  onClose: () => void
  onRefresh: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [editingService, setEditingService] = useState<AgentService | null>(null)

  async function handleDelete(id: string) {
    if (!confirm('이 서비스를 삭제하시겠습니까?')) return
    try {
      await (window as any).electronAPI.deleteAgentService(id)
      onRefresh()
    } catch (error) {
      console.error('삭제 실패:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass-strong rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">⚙️ 서비스 관리</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="text-gray-400">등록된 서비스: {services.length}개</div>
            <button
              onClick={() => {
                setEditingService(null)
                setShowForm(true)
              }}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg text-sm font-medium transition-all"
            >
              + 새 서비스
            </button>
          </div>

          {services.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              등록된 서비스가 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {services.map((service) => (
                <div key={service.id} className="glass rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <div className="font-semibold mb-1">{service.name}</div>
                    <div className="text-sm text-gray-400">
                      {SERVICE_TYPES.find(t => t.value === service.type)?.label || service.type} · 월 한도: $
                      {service.monthlyCap}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingService(service)
                        setShowForm(true)
                      }}
                      className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded text-sm transition-all"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(service.id)}
                      className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm transition-all"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showForm && (
          <ServiceFormModal
            service={editingService}
            onClose={() => setShowForm(false)}
            onSave={() => {
              setShowForm(false)
              onRefresh()
            }}
          />
        )}
      </div>
    </div>
  )
}

function ServiceFormModal({
  service,
  onClose,
  onSave,
}: {
  service: AgentService | null
  onClose: () => void
  onSave: () => void
}) {
  const [name, setName] = useState(service?.name || '')
  const [type, setType] = useState(service?.type || 'openai')
  const [apiKey, setApiKey] = useState(service?.apiKey || '')
  const [baseUrl, setBaseUrl] = useState(service?.baseUrl || '')
  const [monthlyCap, setMonthlyCap] = useState(service?.monthlyCap?.toString() || '')

  async function handleSubmit() {
    try {
      const input = {
        name: name.trim(),
        type,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        monthlyCap: parseFloat(monthlyCap) || 0,
      }

      if (service) {
        await (window as any).electronAPI.updateAgentService(service.id, input)
      } else {
        await (window as any).electronAPI.createAgentService(input)
      }
      onSave()
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장에 실패했습니다.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-8">
      <div className="glass-strong rounded-xl max-w-lg w-full p-6">
        <h3 className="text-xl font-bold mb-4">{service ? '서비스 수정' : '새 서비스'}</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">서비스 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="예: OpenAI 메인"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">서비스 종류</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-gray-900 border border-white/20 rounded-lg px-4 py-3 text-white text-base focus:outline-none focus:border-cyan-500 appearance-none cursor-pointer"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '20px' }}
            >
              {SERVICE_TYPES.map((t) => (
                <option key={t.value} value={t.value} className="bg-gray-900 text-white py-2">
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="sk-..."
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Base URL (선택)</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="https://api.openai.com/v1"
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
            onClick={handleSubmit}
            disabled={!name.trim() || !type}
            className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
