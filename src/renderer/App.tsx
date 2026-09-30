import { useEffect, useState } from 'react'
import { ScanProvider } from './stores/scanStore'
import { EmergencyStopProvider } from './stores/emergencyStore'
import { EmergencyStop } from './components/EmergencyStop'
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

type ViewType = 'now' | 'skillBoard' | 'apiKeys' | 'agentMonitor' | 'home' | 'project-data' | 'changes' | 'maintenance' | 'backups' | 'environment' | 'requests' | 'operations' | 'files' | 'tree' | 'skills' | 'memory' | 'agents' | 'system' | 'settings' | 'dashboard' | 'timeline' | 'aiResources' | 'decisions' | 'experiments' | 'humanGates'

const primaryNav: Array<{ id: ViewType; label: string; icon: string }> = [
  { id: 'now', label: '지금 할 일', icon: '☐' },
  { id: 'skillBoard', label: '스킬 보드', icon: '✧' },
  { id: 'skills', label: '스킬 라이브러리', icon: '✦' },
  { id: 'apiKeys', label: 'API 키 관리', icon: '⚿' },
  { id: 'agentMonitor', label: '사용량', icon: '◔' },
]

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

const moreNav: Array<{ id: ViewType; label: string; icon: string }> = [
  { id: 'home', label: '프로젝트 홈', icon: '⌂' },
  { id: 'changes', label: '변경사항', icon: '⌁' },
  { id: 'files', label: '자료 스캔', icon: '⌗' },
  { id: 'settings', label: '설정', icon: '⚙' },
]

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('now')
  const [moreOpen, setMoreOpen] = useState(false)
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
          <aside className="app-sidebar glass-strong">
            <button className="brand-lockup" onClick={() => navigate('skillBoard')}><span className="brand-mark">D</span><span><b>DIOS</b><small>스킬 보드</small></span></button>
            <div className="sidebar-label">지금</div>
            <nav className="sidebar-nav">{primaryNav.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={`sidebar-link ${currentView === item.id ? 'is-active' : ''}`}><span>{item.icon}</span>{item.label}{item.id === 'skillBoard' && drift > 0 && <em className="nav-count">{drift}</em>}{item.id === 'now' && workCount > 0 && <em className="nav-count">{workCount}</em>}{item.id === 'agentMonitor' && usageAlerts.count > 0 && <em className={`nav-count ${usageAlerts.over > 0 ? 'is-over' : 'is-warn'}`} aria-label={usageAlerts.over > 0 ? '정해 둔 금액을 넘은 곳이 있어요' : '정해 둔 금액에 가까운 곳이 있어요'}>{usageAlerts.count}</em>}<i>›</i></button>)}</nav>
            <div className="sidebar-spacer" />
            <div className="sidebar-label">더 보기</div>
            <nav className="sidebar-nav compact-nav">
              <button type="button" onClick={() => setMoreOpen((open) => !open)} className="sidebar-link"><span>▾</span>{moreOpen ? '접기' : '이전 화면'}<i>›</i></button>
              {moreOpen && moreNav.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={`sidebar-link ${currentView === item.id ? 'is-active' : ''}`}><span>{item.icon}</span>{item.label}<i>›</i></button>)}
            </nav>
            <div className="sidebar-footer"><button onClick={() => navigate('operations')} className="sidebar-link"><span>◎</span>연동 관리<i>›</i></button><button onClick={() => navigate('settings')} className="sidebar-link"><span>⚙</span>설정<i>›</i></button><UpdateButton /><div className="local-badge"><span /> 이 컴퓨터만</div></div>
          </aside>
          <main className="app-main">
            <div className="topbar"><div className="breadcrumb"><span>DIOS</span><b>/</b><strong>{[...primaryNav, ...moreNav].find((item) => item.id === currentView)?.label || '스킬 보드'}</strong></div><div className="topbar-actions"><button onClick={() => navigate('skillBoard')} className="topbar-button">스킬 보드</button><span className="online-dot" /> 이 컴퓨터에서만</div></div>
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
          <EmergencyStop />
        </div>
        </ScanProvider>
      </EmergencyStopProvider>
    </AppErrorBoundary>
  )
}
