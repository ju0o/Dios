import { useState } from 'react'
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
import { GraphView } from './pages/GraphView'
import { TimelineView } from './pages/TimelineView'
import { AIResourceView } from './pages/AIResourceView'
import { DecisionView } from './pages/DecisionView'
import { ExperimentView } from './pages/ExperimentView'
import { HumanGateView } from './pages/HumanGateView'
import { AgentMonitorView } from './pages/AgentMonitorView'
import { CommandPalette } from './components/CommandPalette'
import { AppErrorBoundary } from './components/AppErrorBoundary'

type ViewType = 'home' | 'project-data' | 'changes' | 'maintenance' | 'backups' | 'environment' | 'requests' | 'operations' | 'files' | 'tree' | 'skills' | 'memory' | 'agents' | 'system' | 'settings' | 'dashboard' | 'graph' | 'timeline' | 'aiResources' | 'agentMonitor' | 'decisions' | 'experiments' | 'humanGates'

const primaryNav: Array<{ id: ViewType; label: string; icon: string }> = [
  { id: 'home', label: '프로젝트 홈', icon: '⌂' },
  { id: 'project-data', label: '프로젝트 자료', icon: '⌗' },
  { id: 'changes', label: '변경사항', icon: '⌁' },
  { id: 'maintenance', label: '유지보수', icon: '◌' },
  { id: 'backups', label: '백업·복구', icon: '◒' },
  { id: 'environment', label: '환경 상태', icon: '⌘' },
  { id: 'requests', label: 'Agent 요청서', icon: '✦' },
]

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('home')
  const navigate = (view: string) => setCurrentView(view as ViewType)

  function renderView() {
    switch (currentView) {
      case 'home': return <ProjectHomeView onNavigate={navigate} />
      case 'project-data': return <ProjectConnectionsView onNavigate={navigate} />
      case 'changes': return <ChangesView />
      case 'maintenance': return <MaintenanceView />
      case 'backups': return <BackupView />
      case 'environment': return <EnvironmentView />
      case 'requests': return <TaskRequestView />
      case 'operations': return <OperationsView onNavigate={navigate} />
      case 'files': return <FileExplorer />
      case 'tree': return <TreeView />
      case 'skills': return <SkillView />
      case 'memory': return <MemoryView />
      case 'agents': return <AgentsView />
      case 'system': return <SystemView />
      case 'settings': return <Settings />
      case 'dashboard': return <Dashboard />
      case 'graph': return <GraphView />
      case 'timeline': return <TimelineView />
      case 'aiResources': return <AIResourceView />
      case 'agentMonitor': return <AgentMonitorView />
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
            <button className="brand-lockup" onClick={() => navigate('home')}><span className="brand-mark">D</span><span><b>DIOS</b><small>local operations</small></span></button>
            <div className="sidebar-label">WORKSPACE</div>
            <nav className="sidebar-nav">{primaryNav.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={`sidebar-link ${currentView === item.id ? 'is-active' : ''}`}><span>{item.icon}</span>{item.label}<i>›</i></button>)}</nav>
            <div className="sidebar-spacer" />
            <div className="sidebar-label">LIBRARY</div>
            <nav className="sidebar-nav compact-nav">{[
              ['files', '자료 스캔', '⌗'], ['tree', '파일 탐색', '⊞'], ['skills', 'Skills', '✧'], ['memory', 'Memory', '◫'],
            ].map(([id, label, icon]) => <button key={id} onClick={() => navigate(id)} className={`sidebar-link ${currentView === id ? 'is-active' : ''}`}><span>{icon}</span>{label}<i>›</i></button>)}</nav>
            <div className="sidebar-label">MONITOR</div>
            <nav className="sidebar-nav compact-nav">
              <button onClick={() => navigate('agentMonitor')} className={`sidebar-link ${currentView === 'agentMonitor' ? 'is-active' : ''}`}><span>🤖</span>Agent Monitor<i>›</i></button>
              <button onClick={() => navigate('aiResources')} className={`sidebar-link ${currentView === 'aiResources' ? 'is-active' : ''}`}><span>⬢</span>AI 리소스<i>›</i></button>
            </nav>
            <div className="sidebar-footer"><button onClick={() => navigate('operations')} className="sidebar-link"><span>◎</span>연동 관리<i>›</i></button><button onClick={() => navigate('settings')} className="sidebar-link"><span>⚙</span>설정<i>›</i></button><div className="local-badge"><span /> LOCAL ONLY</div></div>
          </aside>
          <main className="app-main">
            <div className="topbar"><div className="breadcrumb"><span>DIOS</span><b>/</b><strong>{primaryNav.find((item) => item.id === currentView)?.label || '라이브러리'}</strong></div><div className="topbar-actions"><button onClick={() => navigate('requests')} className="topbar-button">✦ 요청서 만들기</button><span className="shortcut-hint">Ctrl K</span><span className="online-dot" /> 로컬 실행 중</div></div>
            <div key={currentView} className="app-content">{renderView()}</div>
          </main>
          <CommandPalette onNavigate={navigate} />
          <EmergencyStop />
        </div>
        </ScanProvider>
      </EmergencyStopProvider>
    </AppErrorBoundary>
  )
}
