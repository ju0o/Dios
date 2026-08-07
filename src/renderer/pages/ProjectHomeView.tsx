import { useEffect, useMemo, useState } from 'react'
import { useScan } from '../stores/scanStore'

type ProjectHomeViewProps = { onNavigate: (view: string) => void }

export function ProjectHomeView({ onNavigate }: ProjectHomeViewProps) {
  const { roots, files } = useScan()
  const api = (window as any).electronAPI || {}
  const [roadmap, setRoadmap] = useState<any[]>([])
  const [backups, setBackups] = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [connections, setConnections] = useState<any[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [transferMessage, setTransferMessage] = useState('')

  useEffect(() => {
    async function load() {
      try {
        if (typeof api.listRoadmap === 'function') setRoadmap(await api.listRoadmap())
        if (typeof api.listBackups === 'function') setBackups(await api.listBackups())
        if (typeof api.listActivity === 'function') setActivity(await api.listActivity())
        if (typeof api.getProjects === 'function') {
          const loadedProjects = await api.getProjects()
          setProjects(loadedProjects || [])
          const savedProjectId = localStorage.getItem('dios:activeProject')
          setSelectedProjectId(savedProjectId && loadedProjects.some((project: any) => project.id === savedProjectId) ? savedProjectId : loadedProjects[0]?.id || '')
        }
      } catch {
        // The home screen stays useful even when optional data is unavailable.
      }
    }
    load()
  }, [])

  useEffect(() => {
    async function loadConnections() {
      if (!selectedProjectId || typeof api.listProjectConnections !== 'function') { setConnections([]); return }
      try { setConnections(await api.listProjectConnections(selectedProjectId) || []) } catch { setConnections([]) }
    }
    loadConnections()
  }, [selectedProjectId])

  const currentPhase = roadmap.find((phase) => phase.status === 'active') || roadmap[0]
  const currentTasks = currentPhase?.tasks || []
  const skillCount = useMemo(() => files.filter((file) => /skill\.md$/i.test(file.relPath)).length, [files])
  const memoryCount = useMemo(() => files.filter((file) => /memory|patterns|sessions|failures|success/i.test(file.relPath)).length, [files])
  const latestBackup = backups[0]
  const activeProject = projects.find((project) => project.id === selectedProjectId)

  async function createProject() {
    if (!newProjectName.trim() || typeof api.createProject !== 'function') return
    const project = await api.createProject({ name: newProjectName.trim(), description: 'DIOS 로컬 운영 프로젝트' })
    setProjects((current) => [project, ...current])
    setSelectedProjectId(project.id)
    localStorage.setItem('dios:activeProject', project.id)
    setNewProjectName('')
  }

  async function exportProject() {
    if (!selectedProjectId || typeof api.exportProject !== 'function') return
    const result = await api.exportProject(selectedProjectId)
    setTransferMessage(result.success ? `프로젝트 내보내기 완료: ${result.path}` : result.canceled ? '' : result.error)
  }

  async function importProject() {
    if (typeof api.importProject !== 'function') return
    const result = await api.importProject()
    if (result.success) {
      setProjects((current) => [result.project, ...current])
      setSelectedProjectId(result.project.id)
      localStorage.setItem('dios:activeProject', result.project.id)
      setTransferMessage('프로젝트를 가져왔습니다.')
    } else if (!result.canceled) setTransferMessage(result.error)
  }

  return (
    <div className="page-wrap page-transition">
      <header className="page-hero">
        <div>
          <div className="eyebrow">PROJECT HOME · DIOS</div>
          <h1>{activeProject?.name || '지금 프로젝트는 어디까지 왔나요?'}</h1>
          <p>현재 상태와 다음 행동을 한눈에 보고, 필요한 공간으로 바로 이동하세요.</p>
        </div>
        <div className="hero-actions">
          {projects.length > 0 && <select value={selectedProjectId} onChange={(event) => { setSelectedProjectId(event.target.value); localStorage.setItem('dios:activeProject', event.target.value) }} className="project-select">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
          <button onClick={importProject} className="soft-button">가져오기</button>
          {activeProject && <button onClick={exportProject} className="soft-button">내보내기</button>}
          <button onClick={() => onNavigate('requests')} className="soft-button primary-button">+ Agent에게 요청하기</button>
        </div>
      </header>

      {transferMessage && <div className="notice-line">{transferMessage}</div>}

      {projects.length === 0 && <div className="project-create-line"><span>아직 프로젝트가 없습니다. 프로젝트를 만들면 이 화면이 프로젝트별 운영 홈으로 바뀝니다.</span><div><input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createProject()} placeholder="프로젝트 이름" /><button onClick={createProject} className="text-link">생성 →</button></div></div>}

      <section className="hero-grid">
        <div className="hero-orbit glass-surface">
          <div className="orbit-glow" />
          <div className="orbit-core"><span>DIOS</span><small>LOCAL WORKSPACE</small></div>
          <div className="orbit-label orbit-label-top">{files.length} files</div>
          <div className="orbit-label orbit-label-right">{roots.length} roots</div>
          <div className="orbit-label orbit-label-bottom">{latestBackup ? 'backup ready' : 'backup needed'}</div>
        </div>
        <div className="hero-copy glass-surface">
          <div className="eyebrow">CURRENT PHASE</div>
          <h2>{currentPhase?.name || 'Phase를 준비하는 중입니다'}</h2>
          <p>{currentPhase?.description || '로드맵을 불러오면 프로젝트 운영 순서가 여기에 표시됩니다.'}</p>
          <div className="task-progress"><span style={{ width: `${currentTasks.length ? (currentTasks.filter((task: any) => task.status === 'done').length / currentTasks.length) * 100 : 0}%` }} /></div>
          <div className="muted-row"><span>{currentTasks.filter((task: any) => task.status === 'done').length}/{currentTasks.length} Task 완료</span><button onClick={() => onNavigate('maintenance')}>운영 상태 보기 →</button></div>
        </div>
      </section>

      <section className="space-section">
        <div className="section-heading"><div><div className="eyebrow">YOUR SPACES</div><h2>프로젝트의 주요 공간</h2></div><span className="section-note">필요한 곳을 클릭하세요</span></div>
        <div className="space-grid">
          {[
            ['changes', '변경사항', '무엇이 바뀌었는지 확인', '⌁', `${activity.filter((item) => item.type === 'test' || item.type === 'scan').length} recent events`],
            ['maintenance', '유지보수', '체크리스트와 운영지침', '◌', `${currentTasks.length} active tasks`],
            ['backups', '백업·복구', '안전한 저장과 복원', '◒', latestBackup ? 'last backup ready' : 'backup recommended'],
            ['environment', '환경 상태', '내 컴퓨터와 작업공간', '⌂', `${roots.length} connected roots`],
            ['requests', 'Agent 요청서', '명확한 작업 지시 만들기', '✦', 'template ready'],
            ['project-data', '프로젝트 자료', '폴더·Skills·Memory 연결', '⌗', `${connections.length} project links`],
            ['files', '자료 탐색', 'Skill·Memory·문서 보기', '⌘', `${skillCount} skills · ${memoryCount} memories`],
          ].map(([id, title, description, icon, meta]) => (
            <button key={id} onClick={() => onNavigate(id)} className="space-link">
              <span className="space-icon">{icon}</span><span className="space-title">{title}</span><span className="space-description">{description}</span><span className="space-meta">{meta}</span><span className="space-arrow">↗</span>
            </button>
          ))}
        </div>
      </section>

      <section className="split-section">
        <div className="section-heading"><div><div className="eyebrow">NEXT ACTIONS</div><h2>다음에 할 일</h2></div><button onClick={() => onNavigate('requests')} className="text-link">요청서 만들기 →</button></div>
        <div className="action-list">
          {currentTasks.filter((task: any) => task.status !== 'done').slice(0, 3).map((task: any, index: number) => <button key={task.id} onClick={() => onNavigate('maintenance')} className="action-row"><span className="action-number">0{index + 1}</span><span><b>{task.title}</b><small>{task.description || '완료 조건을 확인하고 작업을 진행하세요.'}</small></span><span>→</span></button>)}
          {currentTasks.filter((task: any) => task.status !== 'done').length === 0 && <div className="empty-line">현재 Phase의 Task가 모두 완료되었습니다.</div>}
        </div>
      </section>
    </div>
  )
}
