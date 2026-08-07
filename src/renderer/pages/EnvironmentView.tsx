import { useEffect, useState } from 'react'
import { useScan } from '../stores/scanStore'

function formatBytes(value = 0) {
  if (!value) return '확인 불가'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++ }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`
}

export function EnvironmentView() {
  const { roots } = useScan()
  const [status, setStatus] = useState<any>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const api = (window as any).electronAPI || {}

  async function refresh() {
    if (typeof api.getSystemStatus !== 'function') return
    setRefreshing(true)
    setError('')
    try { setStatus(await api.getSystemStatus()) } catch { setError('환경 상태를 불러오지 못했습니다.') } finally { setRefreshing(false) }
  }

  useEffect(() => { refresh() }, [])
  const memoryPercent = status ? Math.round((status.memoryUsed / status.memoryTotal) * 100) : 0
  const diskPercent = status?.disk ? Math.round(((status.disk.total - status.disk.free) / status.disk.total) * 100) : 0

  return (
    <div className="page-wrap page-transition">
      <header className="page-hero"><div><div className="eyebrow">LOCAL ENVIRONMENT</div><h1>내 컴퓨터는 괜찮은가요?</h1><p>DIOS가 실행되는 컴퓨터와 연결된 작업 폴더의 상태입니다.</p></div><button onClick={refresh} className="soft-button">{refreshing ? '새로 확인 중...' : '상태 새로 확인'}</button></header>
      {error && <div className="notice-line">{error} <button onClick={refresh} className="text-link">다시 시도</button></div>}
      <section className="metric-line"><div><span>메모리 사용</span><strong>{status ? `${memoryPercent}%` : '—'}</strong><small>{status && `${formatBytes(status.memoryUsed)} / ${formatBytes(status.memoryTotal)}`}</small></div><div><span>디스크 사용</span><strong>{status?.disk ? `${diskPercent}%` : '확인 불가'}</strong><small>{status?.disk && `${formatBytes(status.disk.free)} 남음`}</small></div><div><span>DIOS 프로세스</span><strong>{status?.pid || '—'}</strong><small>{status?.appUptime ? `${Math.floor(status.appUptime / 60)}분 실행 중` : ''}</small></div></section>
      <section className="split-section"><div className="section-heading"><div><div className="eyebrow">MACHINE</div><h2>실행 환경</h2></div><span className="section-note">로컬 정보만 표시</span></div><div className="detail-list"><div><span>운영체제</span><b>{status?.platform || '확인 중'}</b></div><div><span>컴퓨터 이름</span><b>{status?.hostname || '확인 중'}</b></div><div><span>CPU 코어</span><b>{status?.cpuCount || '확인 중'}</b></div><div><span>데이터베이스</span><b className={status?.databaseExists ? 'status-good' : 'status-bad'}>{status?.databaseExists ? '정상 연결' : '확인 필요'}</b></div></div></section>
      <section className="split-section"><div className="section-heading"><div><div className="eyebrow">CONNECTED FOLDERS</div><h2>연결된 작업 폴더</h2></div><span className="section-note">{roots.length}개 연결</span></div><div className="folder-list">{roots.length ? roots.map((root) => <div key={root} className="folder-row"><span className="folder-dot" /><code>{root}</code><span className="status-good">연결됨</span></div>) : <div className="empty-line">연결된 폴더가 없습니다. 스캔 화면에서 폴더를 추가하세요.</div>}</div></section>
    </div>
  )
}
