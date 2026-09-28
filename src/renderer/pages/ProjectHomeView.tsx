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
  const [todayLine, setTodayLine] = useState('')

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

  useEffect(() => {
    const label = projects.find((project) => project.id === selectedProjectId)?.name || ''
    if (typeof api.usageToday !== 'function') return
    let cancel = false
    api.usageToday(label).then((result: { line?: string }) => {
      if (!cancel) setTodayLine(result?.line || '')
    }).catch(() => { if (!cancel) setTodayLine('') })
    return () => { cancel = true }
  }, [selectedProjectId, projects])

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
    setTransferMessage(result.success ? '프로젝트를 내보냈어요.' : result.canceled ? '' : '내보내지 못했어요. 한 번 더 눌러 주세요.')
  }

  async function importProject() {
    if (typeof api.importProject !== 'function') return
    const result = await api.importProject()
    if (result.success) {
      setProjects((current) => [result.project, ...current])
      setSelectedProjectId(result.project.id)
      localStorage.setItem('dios:activeProject', result.project.id)
      setTransferMessage('프로젝트를 가져왔어요.')
    } else if (!result.canceled) setTransferMessage('가져오지 못했어요. 한 번 더 눌러 주세요.')
  }

  return (
    <div className="page-wrap page-transition">
      <header className="page-hero">
        <div>
          <div className="eyebrow">프로젝트 홈</div>
          <h1>{activeProject?.name || '지금 프로젝트는 어디까지 왔나요?'}</h1>
          <p>지금 상태와 다음에 할 일을 보고, 필요한 곳으로 바로 이동하세요.</p>
          {todayLine && <p className="today-line">{todayLine}</p>}
        </div>
        <div className="hero-actions">
          {projects.length > 0 && <select value={selectedProjectId} onChange={(event) => { setSelectedProjectId(event.target.value); localStorage.setItem('dios:activeProject', event.target.value) }} className="project-select">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
          <button onClick={importProject} className="soft-button">가져오기</button>
          {activeProject && <button onClick={exportProject} className="soft-button">내보내기</button>}
          <button onClick={() => onNavigate('requests')} className="soft-button primary-button">요청서 만들기</button>
        </div>
      </header>

      {transferMessage && <div className="notice-line">{transferMessage}</div>}

      {projects.length === 0 && <div className="project-create-line"><span>아직 프로젝트가 없어요. 만들면 이 화면이 그 프로젝트의 홈이 돼요.</span><div><input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createProject()} placeholder="프로젝트 이름" aria-label="프로젝트 이름" /><button onClick={createProject} className="text-link">만들기</button></div></div>}

      <section className="hero-grid">
        <div className="hero-orbit glass-surface">
          <div className="orbit-glow" />
          <div className="orbit-core"><span>DIOS</span><small>이 컴퓨터</small></div>
          <div className="orbit-label orbit-label-top">파일 {files.length}개</div>
          <div className="orbit-label orbit-label-right">연결 {roots.length}곳</div>
          <div className="orbit-label orbit-label-bottom">{latestBackup ? '백업 있음' : '백업이 필요해요'}</div>
        </div>
        <div className="hero-copy glass-surface">
          <div className="eyebrow">지금 단계</div>
          <h2>{currentPhase?.name || '단계를 준비하는 중이에요'}</h2>
          <p>{currentPhase?.description || '로드맵을 불러오면 진행 순서가 여기에 나와요.'}</p>
          <div className="task-progress"><span style={{ width: `${currentTasks.length ? (currentTasks.filter((task: any) => task.status === 'done').length / currentTasks.length) * 100 : 0}%` }} /></div>
          <div className="muted-row"><span>할 일 {currentTasks.length}개 중 {currentTasks.filter((task: any) => task.status === 'done').length}개 끝남</span><button onClick={() => onNavigate('maintenance')}>운영 상태 보기</button></div>
        </div>
      </section>

      <section className="space-section">
        <div className="section-heading"><div><div className="eyebrow">주요 공간</div><h2>프로젝트의 주요 공간</h2></div><span className="section-note">필요한 곳을 누르세요</span></div>
        <div className="space-grid">
          {[
            ['changes', '변경사항', '무엇이 바뀌었는지 확인', '⌁', `최근 기록 ${activity.filter((item) => item.type === 'test' || item.type === 'scan').length}개`],
            ['maintenance', '유지보수', '체크리스트와 운영지침', '◌', `할 일 ${currentTasks.length}개`],
            ['backups', '백업·복구', '안전한 저장과 복원', '◒', latestBackup ? '최근 백업 있음' : '백업을 권해요'],
            ['environment', '환경 상태', '내 컴퓨터와 작업공간', '⌂', `연결 ${roots.length}곳`],
            ['requests', '요청서', '할 일을 분명하게 적기', '✦', '빈 요청서 있음'],
            ['project-data', '프로젝트 자료', '폴더와 스킬, 기억 연결', '⌗', `연결 ${connections.length}개`],
            ['files', '자료 탐색', '스킬, 기억, 문서 보기', '⌘', `스킬 ${skillCount}개 · 기억 ${memoryCount}개`],
          ].map(([id, title, description, icon, meta]) => (
            <button key={id} onClick={() => onNavigate(id)} className="space-link">
              <span className="space-icon">{icon}</span><span className="space-title">{title}</span><span className="space-description">{description}</span><span className="space-meta">{meta}</span><span className="space-arrow">↗</span>
            </button>
          ))}
        </div>
      </section>

      <section className="split-section">
        <div className="section-heading"><div><div className="eyebrow">다음에 할 일</div><h2>다음에 할 일</h2></div><button onClick={() => onNavigate('requests')} className="text-link">요청서 만들기</button></div>
        <div className="action-list">
          {currentTasks.filter((task: any) => task.status !== 'done').slice(0, 3).map((task: any, index: number) => <button key={task.id} onClick={() => onNavigate('maintenance')} className="action-row"><span className="action-number">0{index + 1}</span><span><b>{task.title}</b><small>{task.description || '완료 조건을 확인하고 작업을 진행하세요.'}</small></span><span>→</span></button>)}
          {currentTasks.filter((task: any) => task.status !== 'done').length === 0 && <div className="empty-line">이번 단계에서 남은 일이 없어요.</div>}
        </div>
      </section>
    </div>
  )
}
