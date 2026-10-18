import { useEffect, useState } from 'react'
import { ScanProvider } from './stores/scanStore'
import { EmergencyStopProvider } from './stores/emergencyStore'
import { ProjectHomeView } from './pages/ProjectHomeView'
import { ProjectConnectionsView } from './pages/ProjectConnectionsView'
import { ChangesView } from './pages/ChangesView'
import { EnvironmentView } from './pages/EnvironmentView'
import { MaintenanceView } from './pages/MaintenanceView'
import { BackupView } from './pages/BackupView'
import { TaskRequestView } from './pages/TaskRequestView'
import { OperationsView } from './pages/OperationsView'
import { FileExplorer } from './pages/FileExplorer'
import { TreeView } from './pages/TreeView'
import { SkillView } from './pages/SkillView'
import { MemoryView } from './pages/MemoryView'
import { AgentsView } from './pages/AgentsView'
import { SystemView } from './pages/SystemView'
import { Settings } from './pages/Settings'
import { Dashboard } from './pages/Dashboard'
import { TimelineView } from './pages/TimelineView'
import { FounderWorkView } from './pages/FounderWorkView'
import { SkillBoardView } from './pages/SkillBoardView'
import { ApiKeysView } from './pages/ApiKeysView'
import { TidyView } from './pages/TidyView'
import { JuRigerView } from './pages/JuRigerView'
import { AIResourceView } from './pages/AIResourceView'
import { DecisionView } from './pages/DecisionView'
import { ExperimentView } from './pages/ExperimentView'
import { HumanGateView } from './pages/HumanGateView'
import { AgentMonitorView } from './pages/AgentMonitorView'
import { WelcomeView } from './pages/WelcomeView'
import { UpdateButton } from './components/UpdateButton'
import { WhatsNewLine } from './components/WhatsNewLine'
import type { StartLook } from '../core/start/welcome'
import { CommandPalette } from './components/CommandPalette'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { PixelField } from './brand/PixelField'
import { SignalMark } from './brand/SignalMark'
import { WORK_HOLD_KEY, firstView, isWorkListOn } from '../core/founder-work/work-hold'

type ViewType = 'now' | 'skillBoard' | 'apiKeys' | 'agentMonitor' | 'tidy' | 'juriger' | 'home' | 'project-data' | 'changes' | 'maintenance' | 'backups' | 'environment' | 'requests' | 'operations' | 'files' | 'tree' | 'skills' | 'memory' | 'agents' | 'system' | 'settings' | 'dashboard' | 'timeline' | 'aiResources' | 'decisions' | 'experiments' | 'humanGates'

interface NavItem { id: ViewType; label: string; icon: string; hold?: boolean }

const WORK_NAV: NavItem = { id: 'now', label: '지금 할 일', icon: '☐' }

const primaryNavBase: NavItem[] = [
  { id: 'skillBoard', label: '스킬 보드', icon: '✧' },
  { id: 'skills', label: '스킬 라이브러리', icon: '✦' },
  { id: 'apiKeys', label: 'API 키 관리', icon: '⚿' },
  { id: 'agentMonitor', label: '사용량', icon: '◔' },
  { id: 'tidy', label: '정리', icon: '▤' },
  { id: 'juriger', label: 'JuRiger', icon: '◉' },
]

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const WELCOME_KEY = 'dios.welcome.seen'

function welcomeSeen(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_KEY) === '1'
  } catch {
    return false
  }
}

function markWelcomeSeen(): void {
  try {
    window.localStorage.setItem(WELCOME_KEY, '1')
  } catch {
    // Without storage the first screen simply shows again next time.
  }
}

const moreNavBase: NavItem[] = [
  { id: 'home', label: '프로젝트 홈', icon: '⌂' },
  { id: 'changes', label: '변경사항', icon: '⌁' },
  { id: 'files', label: '자료 스캔', icon: '⌗' },
  { id: 'operations', label: '연동 관리', icon: '◎' },
]

/** Screen names for the top bar, including ones reached only from inside another screen. */
const SCREEN_TITLES: Partial<Record<ViewType, string>> = {
  settings: '설정',
  'project-data': '프로젝트 자료',
  maintenance: '유지보수',
  backups: '백업·복구',
  environment: '환경 상태',
  requests: '요청서',
  tree: '폴더 구조',
  memory: '기억',
  agents: '에이전트',
  system: '시스템',
  dashboard: '대시보드',
  timeline: '타임라인',
  aiResources: 'AI 자원',
  decisions: '결정 기록',
  experiments: '실험',
  humanGates: '사람 확인',
}

export default function App() {
  const [workOn, setWorkOn] = useState(() => isWorkListOn(storage()))
  const [currentView, setCurrentView] = useState<ViewType>(() => firstView(isWorkListOn(storage())))
  const [moreOpen, setMoreOpen] = useState(false)
  // 지금 할 일 sits in the main menu only while it is switched on; otherwise it waits under 더 보기 with a 보류 tag.
  const primaryNav: NavItem[] = workOn ? [WORK_NAV, ...primaryNavBase] : primaryNavBase
  const moreNav: NavItem[] = workOn ? moreNavBase : [{ ...WORK_NAV, hold: true }, ...moreNavBase]

  // 설정 flips the switch in storage and tells the shell; other windows hear the storage event.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === WORK_HOLD_KEY || event.key === null) setWorkOn(isWorkListOn(storage())) }
    const onLocal = () => setWorkOn(isWorkListOn(storage()))
    window.addEventListener('storage', onStorage)
    window.addEventListener('dios:work-hold', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('dios:work-hold', onLocal)
    }
  }, [])
  const [drift, setDrift] = useState(0)
  const [workCount, setWorkCount] = useState(0)
  const [usageAlerts, setUsageAlerts] = useState({ count: 0, over: 0 })
  const [welcome, setWelcome] = useState<StartLook | null>(null)
  const navigate = (view: string) => {
    if (welcome) markWelcomeSeen()
    setWelcome(null)
    setCurrentView(view as ViewType)
  }

  useEffect(() => {
    if (welcomeSeen()) return
    const api = (window as unknown as { electronAPI?: { startLook?: () => Promise<StartLook> } }).electronAPI
    if (!api?.startLook) return
    let cancel = false
    api.startLook().then((look) => {
      if (!cancel && look && !look.founder) setWelcome(look)
    }).catch(() => {})
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onSkillDrift?: (callback: (payload: { count: number }) => void) => () => void } }).electronAPI
    if (!api?.onSkillDrift) return
    return api.onSkillDrift((payload) => setDrift(payload.count))
  }, [])

  // The drift number is refreshed when the skill board opens, not on a timer.
  useEffect(() => {
    if (currentView !== 'skillBoard') return
    const api = (window as unknown as { electronAPI?: { skillBoardDrift?: () => Promise<{ count: number }> } }).electronAPI
    void api?.skillBoardDrift?.().then((result) => setDrift(result.count)).catch(() => {})
  }, [currentView])

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onAppOpen?: (callback: (view: string) => void) => () => void } }).electronAPI
    if (!api?.onAppOpen) return
    return api.onAppOpen((view) => navigate(view))
  }, [])

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onUsageAlerts?: (callback: (payload: { count: number; over: number }) => void) => () => void } }).electronAPI
    if (!api?.onUsageAlerts) return
    return api.onUsageAlerts((payload) => setUsageAlerts({ count: payload.count, over: payload.over ?? 0 }))
  }, [])

  useEffect(() => {
    type Work = { open: unknown[] }
    const api = (window as unknown as { electronAPI?: { founderWorkList?: () => Promise<Work>; onFounderWork?: (callback: (work: Work) => void) => () => void } }).electronAPI
    if (!api?.onFounderWork) return
    void api.founderWorkList?.().then((work) => setWorkCount(work.open.length)).catch(() => {})
    return api.onFounderWork((work) => setWorkCount(work.open.length))
  }, [])

  function renderView() {
    switch (currentView) {
      case 'now': return <FounderWorkView />
      case 'skillBoard': return <SkillBoardView />
      case 'apiKeys': return <ApiKeysView />
      case 'tidy': return <TidyView />
      case 'juriger': return <JuRigerView />
      case 'home': return <ProjectHomeView onNavigate={navigate} />
      case 'project-data': return <ProjectConnectionsView onNavigate={navigate} />
      case 'changes': return <ChangesView onNavigate={navigate} />
      case 'maintenance': return <MaintenanceView />
      case 'backups': return <BackupView />
      case 'environment': return <EnvironmentView />
      case 'requests': return <TaskRequestView />
      case 'operations': return <OperationsView onNavigate={navigate} />
      case 'files': return <FileExplorer />
      case 'tree': return <TreeView />
      case 'skills': return <SkillView onNavigate={navigate} />
      case 'memory': return <MemoryView />
      case 'agents': return <AgentsView />
      case 'system': return <SystemView />
      case 'settings': return <Settings />
      case 'dashboard': return <Dashboard />
      case 'timeline': return <TimelineView />
      case 'aiResources': return <AIResourceView />
      case 'agentMonitor': return <AgentMonitorView onNavigate={navigate} />
      case 'decisions': return <DecisionView />
      case 'experiments': return <ExperimentView />
      case 'humanGates': return <HumanGateView />
      default: return <ProjectHomeView onNavigate={navigate} />
    }
  }

  return (
    <AppErrorBoundary>
      <EmergencyStopProvider>
        <ScanProvider>
        <div className="app-shell">
          <PixelField />
          <aside className="app-sidebar glass-strong">
            <button className="brand-lockup" onClick={() => navigate(firstView(workOn))} aria-label="DIOS 첫 화면으로"><span className="brand-mark"><SignalMark size={32} /></span><span><b>DIOS</b><small>AI 스킬과 할 일</small></span></button>
            <div className="sidebar-label">자주 쓰는 화면</div>
            <nav className="sidebar-nav">{primaryNav.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={`sidebar-link ${currentView === item.id ? 'is-active' : ''}`}><span>{item.icon}</span>{item.label}{item.id === 'skillBoard' && drift > 0 && <em className="nav-count">{drift}</em>}{item.id === 'now' && workCount > 0 && <em className="nav-count">{workCount}</em>}{item.id === 'agentMonitor' && usageAlerts.count > 0 && <em className={`nav-count ${usageAlerts.over > 0 ? 'is-over' : 'is-warn'}`} aria-label={usageAlerts.over > 0 ? '정해 둔 금액을 넘은 곳이 있어요' : '정해 둔 금액에 가까운 곳이 있어요'}>{usageAlerts.count}</em>}<i>›</i></button>)}</nav>
            <div className="sidebar-spacer" />
            <div className="sidebar-label">더 보기</div>
            <nav className="sidebar-nav compact-nav">
              <button type="button" onClick={() => setMoreOpen((open) => !open)} className="sidebar-link" aria-expanded={moreOpen}><span>{moreOpen ? '▾' : '▸'}</span>{moreOpen ? '접기' : '다른 화면'}<i>›</i></button>
              {moreOpen && moreNav.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={`sidebar-link ${currentView === item.id ? 'is-active' : ''}`}><span>{item.icon}</span>{item.label}{item.hold && <em className="nav-hold" aria-label="잠시 쉬는 화면">보류</em>}<i>›</i></button>)}
            </nav>
            <div className="sidebar-footer"><button onClick={() => navigate('settings')} className={`sidebar-link ${currentView === 'settings' ? 'is-active' : ''}`}><span>⚙</span>설정<i>›</i></button><UpdateButton /></div>
          </aside>
          <main className="app-main">
            <div className="topbar"><div className="breadcrumb"><strong>{[...primaryNav, ...moreNav].find((item) => item.id === currentView)?.label || SCREEN_TITLES[currentView] || 'DIOS'}</strong></div><div className="topbar-actions"><span className="online-dot" /> 이 컴퓨터에서만 돌아가요 <span className="ju-meta">· local</span></div></div>
            <WhatsNewLine />
            <div key={welcome ? 'welcome' : currentView} className="app-content">
              {welcome ? (
                <WelcomeView
                  look={welcome}
                  onOpenLibrary={() => { markWelcomeSeen(); navigate('skills') }}
                  onDismiss={() => { markWelcomeSeen(); setWelcome(null) }}
                />
              ) : renderView()}
            </div>
          </main>
          <CommandPalette onNavigate={navigate} />
        </div>
        </ScanProvider>
      </EmergencyStopProvider>
    </AppErrorBoundary>
  )
}
