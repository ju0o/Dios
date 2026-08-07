import { useEffect, useMemo, useState } from 'react'
import { useScan } from '../stores/scanStore'

type OperationsViewProps = {
  onNavigate: (view: string) => void
}

const apiChecks = [
  ['scanRoots', '폴더 스캔'],
  ['searchDocuments', '문서 검색'],
  ['getGraphData', '관계도 데이터'],
  ['listAIResources', 'AI 자원 관리'],
  ['listHumanGates', 'Human Gate'],
  ['listExperiments', '실험 상태'],
  ['listDecisions', '의사결정 기록'],
] as const

interface ConnectionRecord {
  id: string
  name: string
  provider: string
  purpose: string
  endpoint: string
  apiKey: string
  status: '확인 필요' | '사용 중' | '중지'
  usageAmount: number
  usageUnit: string
  estimatedCost: number
  lastCheckedAt?: number
}

interface RoadmapPhase {
  id: string
  name: string
  description: string
  status: string
  tasks: { id: string; title: string; description: string; status: 'todo' | 'in_progress' | 'done' }[]
}

export function OperationsView({ onNavigate }: OperationsViewProps) {
  const { roots, files } = useScan()
  const electronApi = (window as any).electronAPI || {}
  const [connections, setConnections] = useState<ConnectionRecord[]>([])
  const [showConnectionForm, setShowConnectionForm] = useState(false)
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})
  const [connectionDraft, setConnectionDraft] = useState({ name: '', provider: '', purpose: '', endpoint: '', apiKey: '' })
  const [roadmap, setRoadmap] = useState<RoadmapPhase[]>([])
  const [checkingConnection, setCheckingConnection] = useState<string | null>(null)
  const [usageDrafts, setUsageDrafts] = useState<Record<string, { amount: string; cost: string }>>({})
  const [backupMessage, setBackupMessage] = useState('')

  useEffect(() => {
    async function loadOperationsData() {
      try {
        if (typeof electronApi.listConnections === 'function') {
          setConnections(await electronApi.listConnections())
        } else {
          const saved = JSON.parse(localStorage.getItem('dios:connections') || '[]')
          if (Array.isArray(saved)) setConnections(saved)
        }
        if (typeof electronApi.listRoadmap === 'function') setRoadmap(await electronApi.listRoadmap())
      } catch {
        setConnections([])
      }
    }
    loadOperationsData()
  }, [])

  async function saveConnection() {
    if (!connectionDraft.name.trim() || !connectionDraft.endpoint.trim()) return
    const input = { name: connectionDraft.name.trim(), provider: connectionDraft.provider.trim() || '직접 등록', purpose: connectionDraft.purpose.trim(), endpoint: connectionDraft.endpoint.trim(), apiKey: connectionDraft.apiKey.trim() }
    const created = editingConnectionId && typeof electronApi.updateConnection === 'function'
      ? await electronApi.updateConnection(editingConnectionId, input)
      : typeof electronApi.createConnection === 'function'
        ? await electronApi.createConnection(input)
      : { ...input, id: crypto.randomUUID(), status: '확인 필요' as const }
    const next = editingConnectionId
      ? connections.map((connection) => connection.id === editingConnectionId ? created : connection)
      : [created, ...connections]
    setConnections(next)
    if (typeof electronApi.createConnection !== 'function') localStorage.setItem('dios:connections', JSON.stringify(next))
    setConnectionDraft({ name: '', provider: '', purpose: '', endpoint: '', apiKey: '' })
    setEditingConnectionId(null)
    setShowConnectionForm(false)
  }

  function startEditConnection(connection: ConnectionRecord) {
    setConnectionDraft({ name: connection.name, provider: connection.provider, purpose: connection.purpose || '', endpoint: connection.endpoint, apiKey: connection.apiKey || '' })
    setEditingConnectionId(connection.id)
    setShowConnectionForm(true)
  }

  async function removeConnection(id: string) {
    if (typeof electronApi.deleteConnection === 'function') await electronApi.deleteConnection(id)
    const next = connections.filter((connection) => connection.id !== id)
    setConnections(next)
    if (typeof electronApi.deleteConnection !== 'function') localStorage.setItem('dios:connections', JSON.stringify(next))
  }

  async function checkConnection(id: string) {
    if (typeof electronApi.checkConnection !== 'function') return
    setCheckingConnection(id)
    try {
      const result = await electronApi.checkConnection(id)
      setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: result.status, lastCheckedAt: result.lastCheckedAt } : connection))
    } finally {
      setCheckingConnection(null)
    }
  }

  async function recordUsage(id: string) {
    const draft = usageDrafts[id] || { amount: '', cost: '' }
    if (typeof electronApi.recordConnectionUsage !== 'function') return
    const updated = await electronApi.recordConnectionUsage(id, { usageAmount: Number(draft.amount) || 0, estimatedCost: Number(draft.cost) || 0 })
    setConnections((current) => current.map((connection) => connection.id === id ? updated : connection))
    setUsageDrafts((current) => ({ ...current, [id]: { amount: '', cost: '' } }))
  }

  async function fetchUsage(id: string) {
    if (typeof electronApi.fetchConnectionUsage !== 'function') return
    const result = await electronApi.fetchConnectionUsage(id)
    if (result.success && result.connection) setConnections((current) => current.map((connection) => connection.id === id ? result.connection : connection))
  }

  async function updateTask(id: string, status: 'todo' | 'in_progress' | 'done') {
    if (typeof electronApi.updateRoadmapTask !== 'function') return
    setRoadmap(await electronApi.updateRoadmapTask(id, status))
  }

  async function createBackup() {
    if (typeof electronApi.backupDatabase !== 'function') {
      setBackupMessage('데스크톱 앱에서만 백업할 수 있습니다.')
      return
    }
    const result = await electronApi.backupDatabase()
    setBackupMessage(result.success ? `백업 완료: ${result.path}` : `백업 실패: ${result.error}`)
  }

  const connectedCount = useMemo(
    () => apiChecks.filter(([method]) => typeof electronApi[method] === 'function').length,
    [electronApi]
  )

  const tasks = [
    {
      title: roots.length > 0 ? '연결된 폴더를 다시 확인하기' : '첫 번째 폴더 연결하기',
      description: roots.length > 0 ? `${roots.length}개 폴더가 등록되어 있습니다.` : 'Skill, Memory 또는 프로젝트 폴더를 선택하세요.',
      action: 'files',
      label: roots.length > 0 ? '스캔 화면 열기' : '폴더 연결하기',
      tone: 'blue',
    },
    {
      title: '필요한 Skill을 한글로 읽기',
      description: '원본 SKILL.md는 건드리지 않고 화면에서만 번역본을 사용합니다.',
      action: 'skills',
      label: 'Skill 열기',
      tone: 'purple',
    },
    {
      title: '앱 설정 저장 상태 확인하기',
      description: '자동 스캔, AI 제공자, Human Gate 시간을 관리합니다.',
      action: 'settings',
      label: '설정 열기',
      tone: 'green',
    },
  ]

  return (
    <div className="p-8 animate-fade-in max-w-7xl mx-auto">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-blue-300 mb-2">DIOS 운영센터</p>
          <h1 className="text-3xl font-bold mb-2">오늘 무엇을 하면 되나요?</h1>
          <p className="text-gray-400">개발 용어 대신 현재 상태와 다음 행동을 한 화면에서 확인합니다.</p>
        </div>
        <div className="glass rounded-xl px-5 py-4 min-w-[230px]">
          <div className="text-xs text-gray-500 mb-1">현재 읽어온 자료</div>
          <div className="text-2xl font-bold">{files.length.toLocaleString('ko-KR')}개</div>
          <div className="text-xs text-gray-500 mt-1">연결 폴더 {roots.length}개</div>
        </div>
      </div>

      <section className="glass rounded-2xl p-5 mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div><h2 className="font-semibold">운영 데이터 보호</h2><p className="text-sm text-gray-400 mt-1">설정·연동 목록·로드맵을 포함한 DIOS 데이터베이스를 백업합니다.</p>{backupMessage && <p className="text-xs text-green-300 mt-2 break-all">{backupMessage}</p>}</div>
        <button onClick={createBackup} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium shrink-0">💾 지금 백업</button>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {tasks.map((task) => (
          <div key={task.title} className="glass rounded-2xl p-5 flex flex-col">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-${task.tone}-600/20`}>
              {task.tone === 'blue' ? '📂' : task.tone === 'purple' ? '🌐' : '⚙️'}
            </div>
            <h2 className="font-semibold mb-2">{task.title}</h2>
            <p className="text-sm text-gray-400 leading-6 flex-1">{task.description}</p>
            <button onClick={() => onNavigate(task.action)} className="mt-5 text-left text-sm text-blue-300 hover:text-white transition-colors">
              {task.label} →
            </button>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-xl font-semibold">현재 연결 현황</h2>
              <p className="text-sm text-gray-500 mt-1">DIOS 내부 기능과 Electron API의 실제 공개 상태입니다.</p>
            </div>
            <span className="px-3 py-1 rounded-full bg-green-600/20 text-green-300 text-sm">{connectedCount}/{apiChecks.length} 사용 가능</span>
          </div>
          <div className="space-y-3">
            {apiChecks.map(([method, label]) => {
              const connected = typeof electronApi[method] === 'function'
              return (
                <div key={method} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                  <div><div className="text-sm">{label}</div><code className="text-xs text-gray-600">{method}()</code></div>
                  <span className={`text-xs ${connected ? 'text-green-300' : 'text-gray-500'}`}>{connected ? '연결됨' : '미연결'}</span>
                </div>
              )
            })}
          </div>
          <div className="mt-5 rounded-xl bg-yellow-600/10 border border-yellow-600/20 p-4 text-sm text-yellow-200/80">
            API 키는 이 PC의 DIOS SQLite에만 저장됩니다. 백업 파일에도 포함될 수 있으니 백업 파일을 다른 사람에게 전달하지 마세요.
          </div>
        </section>

        <section className="glass rounded-2xl p-6">
          <h2 className="text-xl font-semibold mb-1">운영 순서</h2>
          <p className="text-sm text-gray-500 mb-5">무언가를 만들고 난 뒤에는 이 순서로 관리하세요.</p>
          <div className="space-y-4">
            {[
              ['1', '계획', 'Phase와 Task를 정하고 완료 조건을 적습니다.'],
              ['2', '실행', 'Agent에게 한 번에 하나의 명확한 작업을 맡깁니다.'],
              ['3', '검토', '변경된 파일과 테스트 결과를 확인합니다.'],
              ['4', '유지보수', '서버·API·폴더 연결 상태와 다음 작업을 기록합니다.'],
            ].map(([number, title, description]) => (
              <div key={number} className="flex gap-4 items-start">
                <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm text-blue-200 shrink-0">{number}</span>
                <div><div className="font-medium">{title}</div><p className="text-sm text-gray-400 mt-1">{description}</p></div>
              </div>
            ))}
          </div>
          <button onClick={() => onNavigate('experiments')} className="mt-6 text-sm text-blue-300 hover:text-white">고급 운영 기록 열기 →</button>
        </section>
      </div>

      <section className="mt-6 glass rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div><h2 className="text-xl font-semibold">외부 API·서비스 목록</h2><p className="text-sm text-gray-500 mt-1">API 키는 이 컴퓨터의 SQLite에만 저장됩니다.</p></div>
          <button onClick={() => { setEditingConnectionId(null); setConnectionDraft({ name: '', provider: '', purpose: '', endpoint: '', apiKey: '' }); setShowConnectionForm((value) => !value) }} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm">{showConnectionForm ? '닫기' : '+ 연동 추가'}</button>
        </div>
        {showConnectionForm && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mb-5 p-4 rounded-xl bg-white/5">
            <input value={connectionDraft.name} onChange={(e) => setConnectionDraft({ ...connectionDraft, name: e.target.value })} placeholder="이름 (예: 번역 API)" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm" />
            <input value={connectionDraft.provider} onChange={(e) => setConnectionDraft({ ...connectionDraft, provider: e.target.value })} placeholder="제공자 (예: OpenAI)" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm" />
            <input value={connectionDraft.purpose} onChange={(e) => setConnectionDraft({ ...connectionDraft, purpose: e.target.value })} placeholder="사용 목적" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm" />
            <input value={connectionDraft.endpoint} onChange={(e) => setConnectionDraft({ ...connectionDraft, endpoint: e.target.value })} placeholder="API 또는 사용량 주소" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm" />
            <input value={connectionDraft.apiKey} onChange={(e) => setConnectionDraft({ ...connectionDraft, apiKey: e.target.value })} placeholder="API 키 (선택)" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm" />
            <button onClick={saveConnection} className="rounded-lg bg-green-600 hover:bg-green-500 text-sm xl:col-span-5">{editingConnectionId ? '연동 정보 수정' : '연동 정보 저장'}</button>
          </div>
        )}
        {connections.length === 0 ? <p className="text-sm text-gray-500">아직 등록한 외부 연동이 없습니다.</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {connections.map((connection) => (
              <div key={connection.id} className="rounded-xl border border-white/10 p-4 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{connection.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{connection.provider} · {connection.purpose || '사용 목적 미입력'}</div>
                  <div className="text-xs text-gray-500 mt-1 break-all">{connection.endpoint}</div>
                  <div className="text-xs text-yellow-300 mt-2">상태: {connection.status} · 키: {connection.apiKey ? (visibleKeys[connection.id] ? connection.apiKey : '••••••••') : '미등록'}</div>
                  <div className="text-xs text-gray-400 mt-2">사용량: {Number(connection.usageAmount || 0).toLocaleString('ko-KR')} {connection.usageUnit || 'requests'} · 비용: ${Number(connection.estimatedCost || 0).toFixed(2)}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {connection.apiKey && <button onClick={() => setVisibleKeys((current) => ({ ...current, [connection.id]: !current[connection.id] }))} className="text-xs text-gray-400 hover:text-white">{visibleKeys[connection.id] ? '키 숨기기' : '키 보기'}</button>}
                    <button onClick={() => startEditConnection(connection)} className="text-xs text-blue-300 hover:text-white">수정</button>
                    <button onClick={() => checkConnection(connection.id)} className="text-xs text-blue-300 hover:text-white">{checkingConnection === connection.id ? '확인 중' : '연결 확인'}</button>
                    <button onClick={() => fetchUsage(connection.id)} className="text-xs text-emerald-300 hover:text-white">자동 사용량</button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <input value={usageDrafts[connection.id]?.amount || ''} onChange={(e) => setUsageDrafts((current) => ({ ...current, [connection.id]: { ...(current[connection.id] || { cost: '' }), amount: e.target.value } }))} placeholder="사용량 추가" className="w-28 bg-black/20 border border-white/10 rounded px-2 py-1 text-xs" />
                    <input value={usageDrafts[connection.id]?.cost || ''} onChange={(e) => setUsageDrafts((current) => ({ ...current, [connection.id]: { ...(current[connection.id] || { amount: '' }), cost: e.target.value } }))} placeholder="비용 추가" className="w-24 bg-black/20 border border-white/10 rounded px-2 py-1 text-xs" />
                    <button onClick={() => recordUsage(connection.id)} className="text-xs text-emerald-300 hover:text-white">직접 기록</button>
                  </div>
                </div>
                <button onClick={() => removeConnection(connection.id)} className="text-xs text-gray-500 hover:text-red-300">삭제</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 glass rounded-2xl p-6">
        <div className="mb-5"><h2 className="text-xl font-semibold">Phase · Task 로드맵</h2><p className="text-sm text-gray-500 mt-1">계획을 잊지 않도록 DIOS 데이터베이스에 저장합니다.</p></div>
        <div className="space-y-4">
          {roadmap.map((phase) => (
            <div key={phase.id} className="rounded-xl border border-white/10 p-4">
              <div className="flex items-start justify-between gap-3 mb-3"><div><h3 className="font-semibold">{phase.name}</h3><p className="text-sm text-gray-400 mt-1">{phase.description}</p></div><span className="text-xs text-blue-200">{phase.tasks.filter((task) => task.status === 'done').length}/{phase.tasks.length} 완료</span></div>
              <div className="space-y-2">
                {phase.tasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                    <span className={`text-sm ${task.status === 'done' ? 'line-through text-gray-500' : ''}`}>{task.title}</span>
                    <select value={task.status} onChange={(e) => updateTask(task.id, e.target.value as 'todo' | 'in_progress' | 'done')} className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs">
                      <option value="todo">예정</option><option value="in_progress">진행 중</option><option value="done">완료</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {roadmap.length === 0 && <p className="text-sm text-gray-500">로드맵을 불러오는 중입니다.</p>}
        </div>
      </section>

      <section className="mt-6 glass rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
          <div><h2 className="text-xl font-semibold">Agent 활용 가이드</h2><p className="text-sm text-gray-500 mt-1">Agent에게 일을 맡길 때 아래 5가지만 알려주면 됩니다.</p></div>
          <button onClick={() => onNavigate('agents')} className="text-sm text-blue-300 hover:text-white">Agent 문서 보기 →</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {[
            ['목표', '무엇을 만들지'], ['범위', '어디까지 바꿀지'], ['자료', '참고할 파일'], ['완료', '무엇을 통과할지'], ['금지', '건드리면 안 되는 것'],
          ].map(([title, description]) => <div key={title} className="rounded-xl bg-white/5 p-4"><div className="text-sm font-semibold text-blue-200">{title}</div><div className="text-xs text-gray-400 mt-2">{description}</div></div>)}
        </div>
      </section>
    </div>
  )
}
