import { useEffect, useState } from 'react'

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

interface HumanGateEvent {
  id: string
  gateId: string
  eventType: 'THRESHOLD_CHANGE' | 'ENABLE' | 'DISABLE' | 'GATE_TRIGGERED'
  triggeredBy: string
  oldValue: string | null
  newValue: string | null
  approved: boolean | null
  approvedBy: string | null
  approvedAt: number | null
  rationale: string | null
  createdAt: number
}

const LEVEL_COLORS = {
  COMPANY: 'bg-blue-600',
  FINANCE: 'bg-green-600',
  AI_RESOURCE: 'bg-cyan-600',
  GOVERNANCE: 'bg-purple-600',
}

export function HumanGateView() {
  const [gates, setGates] = useState<HumanGateConfig[]>([])
  const [pendingEvents, setPendingEvents] = useState<HumanGateEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedGate, setSelectedGate] = useState<HumanGateConfig | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const gatesResult = await (window as any).electronAPI.listHumanGates()
      if (gatesResult.ok) {
        setGates(gatesResult.data)
      }

      const eventsResult = await (window as any).electronAPI.listPendingEvents()
      if (eventsResult.ok) {
        setPendingEvents(eventsResult.data)
      }
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSeedDefaults() {
    try {
      const result = await (window as any).electronAPI.seedDefaultGates()
      if (result.ok) {
        await loadData()
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('기본 게이트 생성 실패:', error)
    }
  }

  async function handleCreate(level: string, name: string, description: string, softThreshold: number, hardThreshold: number) {
    try {
      const result = await (window as any).electronAPI.createHumanGate({
        level,
        name,
        description,
        softThreshold,
        hardThreshold,
      })
      if (result.ok) {
        await loadData()
        setShowCreateModal(false)
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('게이트 생성 실패:', error)
    }
  }

  async function handleToggleEnabled(gateId: string, enabled: boolean, requestedBy: string) {
    try {
      const result = await (window as any).electronAPI.setGateEnabled(gateId, enabled, requestedBy)
      if (result.ok) {
        await loadData()
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('게이트 토글 실패:', error)
    }
  }

  async function handleApproveEvent(eventId: string, approvedBy: string, approved: boolean, rationale?: string) {
    try {
      const result = await (window as any).electronAPI.approveThresholdChange({
        eventId,
        approvedBy,
        approved,
        rationale,
      })
      if (result.ok) {
        await loadData()
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('이벤트 승인 실패:', error)
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
          <h1 className="text-3xl font-bold mb-2">⊘ 휴먼 게이트</h1>
          <p className="text-gray-400">AI 자율성을 제어하는 안전 장치</p>
        </div>
        <div className="flex gap-2">
          {gates.length === 0 && (
            <button
              onClick={handleSeedDefaults}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
            >
              기본 게이트 생성
            </button>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-all"
          >
            + 새 게이트
          </button>
        </div>
      </div>

      {/* Pending Events */}
      {pendingEvents.length > 0 && (
        <div className="glass rounded-xl p-6 mb-6 border border-yellow-600/30">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            승인 대기 ({pendingEvents.length})
          </h2>
          <div className="space-y-3">
            {pendingEvents.map((event) => (
              <PendingEventCard
                key={event.id}
                event={event}
                gate={gates.find((g) => g.id === event.gateId)}
                onApprove={handleApproveEvent}
              />
            ))}
          </div>
        </div>
      )}

      {/* Gates List */}
      {gates.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center text-gray-500">
          휴먼 게이트가 없습니다. 기본 게이트를 생성하거나 새 게이트를 추가하세요.
        </div>
      ) : (
        <div className="grid gap-4">
          {gates.map((gate) => (
            <div
              key={gate.id}
              className="glass rounded-xl p-6 hover:border-white/20 transition-all cursor-pointer"
              onClick={() => setSelectedGate(gate)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-semibold">{gate.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-medium text-white ${LEVEL_COLORS[gate.level]}`}>
                      {gate.level}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${gate.enabled ? 'bg-green-600/20 text-green-400' : 'bg-gray-600/20 text-gray-400'}`}>
                      {gate.enabled ? '활성' : '비활성'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{gate.description}</p>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>Soft: {(gate.softThreshold * 100).toFixed(0)}%</span>
                    <span>Hard: {(gate.hardThreshold * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateGateModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Detail Modal */}
      {selectedGate && (
        <GateDetailModal
          gate={selectedGate}
          onClose={() => setSelectedGate(null)}
          onToggleEnabled={handleToggleEnabled}
        />
      )}
    </div>
  )
}

function PendingEventCard({
  event,
  gate,
  onApprove,
}: {
  event: HumanGateEvent
  gate?: HumanGateConfig
  onApprove: (eventId: string, approvedBy: string, approved: boolean, rationale?: string) => void
}) {
  const [approvedBy, setApprovedBy] = useState('')
  const [rationale, setRationale] = useState('')

  return (
    <div className="glass rounded-lg p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold">{gate?.name || '알 수 없는 게이트'}</span>
            <span className="text-xs text-gray-500">{event.eventType}</span>
          </div>
          <p className="text-sm text-gray-400">by {event.triggeredBy}</p>
          {event.rationale && <p className="text-xs text-gray-500 mt-1">{event.rationale}</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={approvedBy}
          onChange={(e) => setApprovedBy(e.target.value)}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/20"
          placeholder="승인자"
        />
        <input
          type="text"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/20"
          placeholder="사유 (선택)"
        />
        <button
          onClick={() => onApprove(event.id, approvedBy, true, rationale)}
          disabled={!approvedBy.trim()}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
        >
          승인
        </button>
        <button
          onClick={() => onApprove(event.id, approvedBy, false, rationale)}
          disabled={!approvedBy.trim()}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
        >
          거부
        </button>
      </div>
    </div>
  )
}

function CreateGateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (level: string, name: string, description: string, softThreshold: number, hardThreshold: number) => void
}) {
  const [level, setLevel] = useState('COMPANY')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [softThreshold, setSoftThreshold] = useState('0.7')
  const [hardThreshold, setHardThreshold] = useState('0.9')

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass-strong rounded-xl max-w-lg w-full p-6">
        <h2 className="text-2xl font-bold mb-6">새 휴먼 게이트</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">레벨</label>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
            >
              <option value="COMPANY">COMPANY</option>
              <option value="FINANCE">FINANCE</option>
              <option value="AI_RESOURCE">AI_RESOURCE</option>
              <option value="GOVERNANCE">GOVERNANCE</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="게이트 이름"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20 h-20 resize-none"
              placeholder="게이트 목적 설명"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Soft 임계값 (0~1)</label>
              <input
                type="number"
                value={softThreshold}
                onChange={(e) => setSoftThreshold(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
                min="0"
                max="1"
                step="0.01"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Hard 임계값 (0~1)</label>
              <input
                type="number"
                value={hardThreshold}
                onChange={(e) => setHardThreshold(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
                min="0"
                max="1"
                step="0.01"
              />
            </div>
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
            onClick={() => onCreate(level, name, description, parseFloat(softThreshold), parseFloat(hardThreshold))}
            disabled={!name.trim() || !description.trim()}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
          >
            생성
          </button>
        </div>
      </div>
    </div>
  )
}

function GateDetailModal({
  gate,
  onClose,
  onToggleEnabled,
}: {
  gate: HumanGateConfig
  onClose: () => void
  onToggleEnabled: (gateId: string, enabled: boolean, requestedBy: string) => void
}) {
  const [requestedBy, setRequestedBy] = useState('')

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass-strong rounded-xl max-w-2xl w-full p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold">{gate.name}</h2>
              <span className={`px-3 py-1 rounded text-sm font-medium text-white ${LEVEL_COLORS[gate.level]}`}>
                {gate.level}
              </span>
            </div>
            <p className="text-gray-400">{gate.description}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">✕</button>
        </div>

        <div className="glass rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-400 mb-1">Soft 임계값</div>
              <div className="text-2xl font-bold">{(gate.softThreshold * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">Hard 임계값</div>
              <div className="text-2xl font-bold">{(gate.hardThreshold * 100).toFixed(0)}%</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
            placeholder="요청자 이름"
          />
          <button
            onClick={() => {
              onToggleEnabled(gate.id, !gate.enabled, requestedBy)
              setRequestedBy('')
            }}
            disabled={!requestedBy.trim()}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:bg-gray-700 disabled:cursor-not-allowed ${
              gate.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {gate.enabled ? '비활성화' : '활성화'}
          </button>
        </div>
      </div>
    </div>
  )
}
