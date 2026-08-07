type AsyncStateProps = {
  loading?: boolean
  error?: string
  onRetry?: () => void
  children: React.ReactNode
}

export function AsyncState({ loading, error, onRetry, children }: AsyncStateProps) {
  if (loading) return <div className="async-state"><span className="loading-orbit" /><p>불러오는 중입니다...</p></div>
  if (error) return <div className="async-state error-state"><span>!</span><p>{error}</p>{onRetry && <button onClick={onRetry} className="soft-button">다시 시도</button>}</div>
  return <>{children}</>
}
