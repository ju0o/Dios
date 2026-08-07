import { useEffect, useState } from 'react'

interface DecisionEntry {
  id: string
  topic: string
  options: string[]
  chosenOption: string
  rationale: string
  approvedBy: string
  previousEntryHash: string | null
  entryHash: string
  createdAt: number
}

export function DecisionView() {
  const [decisions, setDecisions] = useState<DecisionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [chainIntegrity, setChainIntegrity] = useState<{ valid: boolean; brokenAt?: string } | null>(null)

  useEffect(() => {
    loadDecisions()
    verifyChain()
  }, [])

  async function loadDecisions() {
    try {
      const result = await (window as any).electronAPI.listDecisions()
      setDecisions(result || [])
    } catch (error) {
      console.error('의사결정 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function verifyChain() {
    try {
      const result = await (window as any).electronAPI.verifyDecisionChain()
      setChainIntegrity(result)
    } catch (error) {
      console.error('체인 검증 실패:', error)
    }
  }

  async function handleCreate(topic: string, options: string[], chosenOption: string, rationale: string, approvedBy: string) {
    try {
      const result = await (window as any).electronAPI.createDecision({
        topic,
        options,
        chosenOption,
        rationale,
        approvedBy,
      })
      if (result.success) {
        await loadDecisions()
        await verifyChain()
        setShowCreateModal(false)
      } else {
        alert(result.error)
      }
    } catch (error) {
      console.error('의사결정 생성 실패:', error)
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
          <h1 className="text-3xl font-bold mb-2">◆ 의사결정 레저</h1>
          <p className="text-gray-400">블록체인 기반의 불변 의사결정 기록</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium transition-all"
        >
          + 새 결정
        </button>
      </div>

      {/* Chain Integrity */}
      <div className="glass rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{chainIntegrity?.valid ? '✅' : '⚠️'}</span>
          <div>
            <div className="font-semibold">
              {chainIntegrity?.valid ? '체인 무결성 정상' : '체인 손상 감지'}
            </div>
            <div className="text-sm text-gray-400">
              {chainIntegrity?.valid
                ? '모든 의사결정 기록이 유효합니다'
                : `손상 지점: ${chainIntegrity?.brokenAt?.slice(0, 8)}...`}
            </div>
          </div>
        </div>
      </div>

      {decisions.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center text-gray-500">
          의사결정 기록이 없습니다. 새 결정을 기록하세요.
        </div>
      ) : (
        <div className="space-y-4">
          {decisions.map((decision, index) => (
            <div key={decision.id} className="glass rounded-xl p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs text-gray-500 font-mono">#{index + 1}</span>
                    <h3 className="text-xl font-semibold">{decision.topic}</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{decision.rationale}</p>
                </div>
              </div>

              {/* Options */}
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-2">선택지</div>
                <div className="flex flex-wrap gap-2">
                  {decision.options.map((opt, i) => (
                    <div
                      key={i}
                      className={`px-3 py-1.5 rounded-lg text-sm ${
                        opt === decision.chosenOption
                          ? 'bg-green-600/20 border border-green-600/50 text-green-400'
                          : 'bg-white/5 border border-white/10 text-gray-400'
                      }`}
                    >
                      {opt === decision.chosenOption && '✓ '}
                      {opt}
                    </div>
                  ))}
                </div>
              </div>

              {/* Metadata */}
              <div className="flex items-center gap-4 text-xs text-gray-500 pt-4 border-t border-white/5">
                <span>승인자: {decision.approvedBy}</span>
                <span>{new Date(decision.createdAt).toLocaleString('ko-KR')}</span>
                <span className="ml-auto font-mono text-[10px]" title={decision.entryHash}>
                  Hash: {decision.entryHash.slice(0, 16)}...
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateDecisionModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}

function CreateDecisionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (topic: string, options: string[], chosenOption: string, rationale: string, approvedBy: string) => void
}) {
  const [topic, setTopic] = useState('')
  const [optionsText, setOptionsText] = useState('')
  const [chosenOption, setChosenOption] = useState('')
  const [rationale, setRationale] = useState('')
  const [approvedBy, setApprovedBy] = useState('')

  const options = optionsText.split('\n').filter((o) => o.trim())

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass-strong rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-2xl font-bold mb-6">새 의사결정 기록</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">주제</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="결정할 주제"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">선택지 (한 줄에 하나씩)</label>
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20 h-32 resize-none font-mono text-sm"
              placeholder={"옵션 A\n옵션 B\n옵션 C"}
            />
            {options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {options.map((opt, i) => (
                  <span key={i} className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400">
                    {opt}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">선택한 옵션</label>
            <select
              value={chosenOption}
              onChange={(e) => setChosenOption(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
            >
              <option value="">선택하세요</option>
              {options.map((opt, i) => (
                <option key={i} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">근거</label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20 h-24 resize-none"
              placeholder="이 결정을 내린 이유"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">승인자</label>
            <input
              type="text"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
              placeholder="승인자 이름"
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
            onClick={() => onCreate(topic, options, chosenOption, rationale, approvedBy)}
            disabled={!topic.trim() || options.length < 2 || !chosenOption || !rationale.trim() || !approvedBy.trim()}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
          >
            기록
          </button>
        </div>
      </div>
    </div>
  )
}
