import { useEffect, useMemo, useState } from 'react'
import { useScan } from '../stores/scanStore'

type ConnectionKind = 'folder' | 'skills' | 'memory'
type Connection = { id: string; projectId: string; kind: ConnectionKind; label: string; path: string; updatedAt: number }

const kindLabels: Record<ConnectionKind, string> = {
  folder: '프로젝트 폴더',
  skills: 'Skills 폴더',
  memory: 'Memory 폴더',
}

export function ProjectConnectionsView({ onNavigate }: { onNavigate: (view: string) => void }) {
  const api = (window as any).electronAPI || {}
  const { setRoots, setFiles } = useScan()
  const [projects, setProjects] = useState<any[]>([])
  const [projectId, setProjectId] = useState(localStorage.getItem('dios:activeProject') || '')
  const [connections, setConnections] = useState<Connection[]>([])
  const [kind, setKind] = useState<ConnectionKind>('folder')
  const [label, setLabel] = useState('')
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function loadConnections(targetId = projectId) {
    if (!targetId || typeof api.listProjectConnections !== 'function') {
      setConnections([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setConnections(await api.listProjectConnections(targetId) || [])
      setError('')
    } catch {
      setError('프로젝트 연결 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function loadProjects() {
      try {
        const loaded = typeof api.getProjects === 'function' ? await api.getProjects() : []
        setProjects(loaded || [])
        const saved = localStorage.getItem('dios:activeProject')
        const next = saved && loaded.some((project: any) => project.id === saved) ? saved : loaded[0]?.id || ''
        setProjectId(next)
        if (next) localStorage.setItem('dios:activeProject', next)
        await loadConnections(next)
      } catch {
        setError('프로젝트 목록을 불러오지 못했습니다.')
        setLoading(false)
      }
    }
    loadProjects()
  }, [])

  const selectedProject = projects.find((project) => project.id === projectId)
  const grouped = useMemo(() => connections.reduce((result, connection) => {
    ;(result[connection.kind] ||= []).push(connection)
    return result
  }, {} as Record<ConnectionKind, Connection[]>), [connections])

  async function selectProject(next: string) {
    setProjectId(next)
    localStorage.setItem('dios:activeProject', next)
    setMessage('')
    await loadConnections(next)
  }

  async function saveConnection() {
    if (!projectId) { setError('먼저 프로젝트 홈에서 프로젝트를 만드세요.'); return }
    if (!path.trim()) { setError('연결할 폴더 경로를 입력하세요.'); return }
    setSaving(true)
    try {
      const result = await api.saveProjectConnection({ projectId, kind, label, path })
      if (!result.success) { setError(result.error || '연결을 저장하지 못했습니다.'); return }
      setConnections(result.connections || [])
      setPath('')
      setLabel('')
      setMessage('프로젝트에 자료 연결을 저장했습니다.')
      setError('')
    } catch {
      setError('프로젝트 자료 연결을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function removeConnection(id: string) {
    if (!window.confirm('이 프로젝트 연결만 삭제할까요? 실제 폴더와 파일은 삭제되지 않습니다.')) return
    try {
      await api.deleteProjectConnection(id)
      await loadConnections()
      setMessage('연결 정보만 삭제했습니다.')
    } catch {
      setError('연결 정보를 삭제하지 못했습니다.')
    }
  }

  async function scanConnection(connection: Connection) {
    try {
      const result = await api.scanRoots([connection.path])
      setRoots([connection.path])
      setFiles(result || [])
      localStorage.setItem('dios:scanRoots', JSON.stringify([connection.path]))
      setMessage(`${kindLabels[connection.kind]}를 현재 자료 화면에 연결했습니다. ${result?.length || 0}개 파일을 읽었습니다.`)
    } catch {
      setError('폴더를 읽지 못했습니다. 경로가 존재하는지 확인하세요.')
    }
  }

  const renderGroup = (groupKind: ConnectionKind) => (
    <section className="connection-group" key={groupKind}>
      <div className="section-heading"><div><div className="eyebrow">{groupKind.toUpperCase()}</div><h2>{kindLabels[groupKind]}</h2></div><span className="section-note">{grouped[groupKind]?.length || 0}개 연결</span></div>
      <div className="connection-list">
        {(grouped[groupKind] || []).map((connection) => (
          <div className="connection-row" key={connection.id}>
            <span className="connection-dot" />
            <span className="connection-main"><b>{connection.label || connection.path.split(/[\\/]/).filter(Boolean).pop()}</b><code>{connection.path}</code></span>
            <button onClick={() => scanConnection(connection)} className="text-link">자료 화면에서 열기</button>
            <button onClick={() => removeConnection(connection.id)} className="text-link danger-link">삭제</button>
          </div>
        ))}
        {!grouped[groupKind]?.length && <div className="empty-line">아직 연결된 {kindLabels[groupKind]}가 없습니다.</div>}
      </div>
    </section>
  )

  return (
    <div className="page-wrap page-transition">
      <header className="page-hero"><div><div className="eyebrow">PROJECT MATERIALS</div><h1>프로젝트 자료를 따로 관리하세요</h1><p>프로젝트마다 폴더·Skills·Memory를 연결해 두면, 나중에 어디의 자료인지 헷갈리지 않습니다.</p></div><button onClick={() => onNavigate('home')} className="soft-button">프로젝트 홈으로</button></header>
      {error && <div className="notice-line">{error}</div>}
      {message && <div className="notice-line">{message}</div>}
      <section className="connection-toolbar">
        <div className="section-heading"><div><div className="eyebrow">ACTIVE PROJECT</div><h2>연결할 프로젝트</h2></div><span className="section-note">{selectedProject?.name || '프로젝트를 먼저 만드세요'}</span></div>
        <select value={projectId} onChange={(event) => selectProject(event.target.value)} className="project-select wide-select"><option value="">프로젝트 선택</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      </section>
      {!projects.length && <div className="empty-line">프로젝트 홈에서 첫 프로젝트를 만든 후 자료를 연결할 수 있습니다.</div>}
      {projects.length > 0 && <>
        <section className="connection-form">
          <div className="section-heading"><div><div className="eyebrow">ADD CONNECTION</div><h2>새 자료 연결</h2></div><span className="section-note">실제 폴더와 파일은 수정하지 않습니다</span></div>
          <div className="connection-fields"><select value={kind} onChange={(event) => setKind(event.target.value as ConnectionKind)}><option value="folder">프로젝트 폴더</option><option value="skills">Skills 폴더</option><option value="memory">Memory 폴더</option></select><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="표시 이름 (예: DIOS 문서)" /><input value={path} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveConnection()} placeholder="폴더 경로 (예: D:\\MyProject)" /><button onClick={saveConnection} disabled={saving} className="soft-button primary-button">{saving ? '저장 중...' : '연결 저장'}</button></div>
          <p className="form-hint">현재는 폴더 경로를 직접 입력합니다. 연결 저장 후 “자료 화면에서 열기”를 누르면 해당 폴더를 스캔합니다.</p>
        </section>
        {loading ? <div className="empty-line">프로젝트 연결을 불러오는 중입니다...</div> : (['folder', 'skills', 'memory'] as ConnectionKind[]).map(renderGroup)}
      </>}
    </div>
  )
}
