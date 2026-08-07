import { useEffect, useState } from 'react'

interface Experiment {
  id: string
  name: string
  description: string
  state: string
  createdBy: string
  approvedBy: string | null
  approvedAt: number | null
  createdAt: number
  updatedAt: number
}

interface Transition {
  id: string
  experimentId: string
  fromState: string
  toState: string
  triggeredBy: string
  role: string
  rationale: string | null
  createdAt: number
}

const STATE_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-600',
  HYPOTHESIS: 'bg-blue-600',
  VALIDATION: 'bg-yellow-600',
  APPROVED: 'bg-green-600',
  RUNNING: 'bg-purple-600',
  SCALE: 'bg-indigo-600',
  PIVOT: 'bg-orange-600',
  HOLD: 'bg-gray-500',
  TERMINATED: 'bg-red-600',
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['HYPOTHESIS'],
  HYPOTHESIS: ['VALIDATION', 'TERMINATED'],
  VALIDATION: ['APPROVED', 'PIVOT', 'TERMINATED'],
  APPROVED: ['RUNNING', 'HOLD', 'TERMINATED'],
  RUNNING: ['SCALE', 'PIVOT', 'HOLD', 'TERMINATED'],
  SCALE: ['HOLD', 'TERMINATED'],
  PIVOT: ['HYPOTHESIS', 'TERMINATED'],
  HOLD: ['RUNNING', 'TERMINATED'],
  TERMINATED: [],
}

export function ExperimentView() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null)
  const [transitions, setTransitions] = useState<Transition[]>([])

  useEffect(() => {
    loadExperiments()
  }, [])

  async function loadExperiments() {
    try {
      const result = await (window as any).electronAPI.listExperiments()
      if (result.ok) {
        setExperiments(result.data)
      }
    } catch (error) {
      console.error('실험 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(name: string, description: string, createdBy: string) {
    try {
      const result = await (window as any).electronAPI.createExperiment({
        name,
        description,
        createdBy,
      })
      if (result.ok) {
        await loadExperiments()
        setShowCreateModal(false)
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('실험 생성 실패:', error)
    }
  }

  async function handleTransition(experimentId: string, toState: string, triggeredBy: string, role: string) {
    try {
      const result = await (window as any).electronAPI.transitionExperiment({
        experimentId,
        toState,
        triggeredBy,
        role,
      })
      if (result.ok) {
        await loadExperiments()
        if (selectedExperiment?.id === experimentId) {
          await loadTransitions(experimentId)
        }
      } else {
        alert(result.error.message)
      }
    } catch (error) {
      console.error('상태 전이 실패:', error)
    }
  }

  async function loadTransitions(experimentId: string) {
    try {
      const result = await (window as any).electronAPI.listExperimentTransitions(experimentId)
      if (result.ok) {
        setTransitions(result.data)
      }
    } catch (error) {
      console.error('전이 기록 로드 실패:', error)
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
          <h1 className="text-3xl font-bold mb-2">⬡ 실험 관리</h1>
          <p className="text-gray-400">실험의 상태를 추적하고 관리하세요</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-all"
        >
          + 새 실험
        </button>
      </div>

      {experiments.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center text-gray-500">
          실험이 없습니다. 새 실험을 생성하세요.
        </div>
      ) : (
        <div className="grid gap-4">
          {experiments.map((exp) => (
            <div
              key={exp.id}
              className="glass rounded-xl p-6 hover:border-white/20 transition-all cursor-pointer"
              onClick={() => {
                setSelectedExperiment(exp)
                loadTransitions(exp.id)
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-semibold">{exp.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-medium text-white ${STATE_COLORS[exp.state]}`}>
                      {exp.state}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{exp.description}</p>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>생성자: {exp.createdBy}</span>
                    <span>생성일: {new Date(exp.createdAt).toLocaleDateString('ko-KR')}</span>
                    {exp.approvedBy && <span>승인자: {exp.approvedBy}</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateExperimentModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Detail Modal */}
      {selectedExperiment && (
        <ExperimentDetailModal
          experiment={selectedExperiment}
          transitions={transitions}
          onClose={() => setSelectedExperiment(null)}
          onTransition={handleTransition}
        />
      )}
    </div>
  )
}

function CreateExperimentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, description: string, createdBy: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [createdBy, setCreatedBy] = useState('')

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass-strong rounded-xl max-w-lg w-full p-6">
        <h2 className="text-2xl font-bold mb-6">새 실험 생성</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">실험 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="실험 이름을 입력하세요"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20 h-24 resize-none"
              placeholder="실험 목적과 내용을 설명하세요"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">생성자</label>
            <input
              type="text"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="생성자 이름"
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
            onClick={() => onCreate(name, description, createdBy)}
            disabled={!name.trim() || !createdBy.trim()}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
          >
            생성
          </button>
        </div>
      </div>
    </div>
  )
}

function ExperimentDetailModal({
  experiment,
  transitions,
  onClose,
  onTransition,
}: {
  experiment: Experiment
  transitions: Transition[]
  onClose: () => void
  onTransition: (experimentId: string, toState: string, triggeredBy: string, role: string) => void
}) {
  const [showTransitionForm, setShowTransitionForm] = useState(false)
  const [triggeredBy, setTriggeredBy] = useState('')
  const [role, setRole] = useState<'HERMES_B' | 'CEO' | 'SYSTEM'>('HERMES_B')

  const nextStates = VALID_TRANSITIONS[experiment.state] || []

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass-strong rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-white/10 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-bold">{experiment.name}</h2>
                <span className={`px-3 py-1 rounded text-sm font-medium text-white ${STATE_COLORS[experiment.state]}`}>
                  {experiment.state}
                </span>
              </div>
              <p className="text-gray-400">{experiment.description}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Transition Actions */}
          {nextStates.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">상태 전이</h3>
              {!showTransitionForm ? (
                <div className="flex gap-2 flex-wrap">
                  {nextStates.map((state) => (
                    <button
                      key={state}
                      onClick={() => setShowTransitionForm(true)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-all ${STATE_COLORS[state]} hover:opacity-80`}
                    >
                      → {state}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="glass rounded-xl p-4 space-y-3">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">실행자</label>
                    <input
                      type="text"
                      value={triggeredBy}
                      onChange={(e) => setTriggeredBy(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
                      placeholder="실행자 이름"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">역할</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as any)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
                    >
                      <option value="HERMES_B">HERMES_B</option>
                      <option value="CEO">CEO</option>
                      <option value="SYSTEM">SYSTEM</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    {nextStates.map((state) => (
                      <button
                        key={state}
                        onClick={() => {
                          onTransition(experiment.id, state, triggeredBy, role)
                          setShowTransitionForm(false)
                          setTriggeredBy('')
                        }}
                        disabled={!triggeredBy.trim()}
                        className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-all ${STATE_COLORS[state]} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        → {state}
                      </button>
                    ))}
                    <button
                      onClick={() => setShowTransitionForm(false)}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Transition History */}
          <div>
            <h3 className="text-lg font-semibold mb-3">전이 기록</h3>
            {transitions.length === 0 ? (
              <div className="text-gray-500 text-sm">전이 기록이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {transitions.map((t) => (
                  <div key={t.id} className="glass rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs text-white ${STATE_COLORS[t.fromState]}`}>
                        {t.fromState}
                      </span>
                      <span className="text-gray-500">→</span>
                      <span className={`px-2 py-0.5 rounded text-xs text-white ${STATE_COLORS[t.toState]}`}>
                        {t.toState}
                      </span>
                      <span className="text-gray-400 ml-2">by {t.triggeredBy} ({t.role})</span>
                      <span className="text-gray-500 ml-auto text-xs">
                        {new Date(t.createdAt).toLocaleString('ko-KR')}
                      </span>
                    </div>
                    {t.rationale && <p className="text-xs text-gray-400 mt-1">{t.rationale}</p>}
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
