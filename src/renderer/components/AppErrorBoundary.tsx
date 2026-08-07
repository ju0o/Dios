import { Component, ErrorInfo, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error('DIOS 화면 오류:', error, info) }

  render() {
    if (!this.state.error) return this.props.children
    return <div className="app-error-screen"><div><span>!</span><div className="eyebrow">SCREEN ERROR</div><h1>이 화면을 불러오지 못했습니다.</h1><p>다시 시도하거나 DIOS를 재실행해 주세요.</p><button onClick={() => window.location.reload()} className="soft-button primary-button">다시 시작</button></div></div>
  }
}
