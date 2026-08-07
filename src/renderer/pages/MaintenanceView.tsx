import { useEffect, useState } from 'react'
import { useScan } from '../stores/scanStore'

export function MaintenanceView() {
  const { roots } = useScan()
  const [items, setItems] = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [runbook, setRunbook] = useState('')
  const [runbookSaving, setRunbookSaving] = useState(false)
  const [runbookMessage, setRunbookMessage] = useState('')
  const [error, setError] = useState('')
  const api = (window as any).electronAPI || {}

  async function load() {
    try {
      if (typeof api.listMaintenance === 'function') setItems(await api.listMaintenance())
      if (typeof api.listActivity === 'function') setActivity(await api.listActivity())
      const projectId = localStorage.getItem('dios:activeProject')
      if (projectId && typeof api.getProjectRunbook === 'function') setRunbook((await api.getProjectRunbook(projectId)).content || '')
      setError('')
    } catch { setError('유지보수 정보를 불러오지 못했습니다.') }
  }
  useEffect(() => { load() }, [])
  async function toggle(item: any) { if (typeof api.updateMaintenance === 'function') setItems(await api.updateMaintenance(item.id, !item.done)) }
  async function saveRunbook() {
    const projectId = localStorage.getItem('dios:activeProject')
    if (!projectId || typeof api.saveProjectRunbook !== 'function') { setRunbookMessage('먼저 프로젝트 홈에서 프로젝트를 선택하세요.'); return }
    setRunbookSaving(true)
    try { await api.saveProjectRunbook(projectId, runbook); setRunbookMessage('운영지침을 저장했습니다.') } catch { setRunbookMessage('운영지침 저장에 실패했습니다.') } finally { setRunbookSaving(false) }
  }
  const complete = items.filter((item) => item.done).length

  return (
    <div className="page-wrap page-transition">
      <header className="page-hero"><div><div className="eyebrow">MAINTENANCE ROOM</div><h1>유지보수는 잘 되고 있나요?</h1><p>만들어 놓은 프로그램을 계속 건강하게 유지하는 체크리스트입니다.</p></div><div className="completion-ring"><strong>{complete}/{items.length || 6}</strong><span>완료</span></div></header>
      {error && <div className="notice-line">{error} <button onClick={load} className="text-link">다시 시도</button></div>}
      <section className="space-section"><div className="section-heading"><div><div className="eyebrow">CHECKLIST</div><h2>오늘 확인할 항목</h2></div><span className="section-note">{roots.length}개 폴더 연결</span></div><div className="check-list">{items.map((item) => <button key={item.id} onClick={() => toggle(item)} className={`check-row ${item.done ? 'is-done' : ''}`}><span className="check-circle">{item.done ? '✓' : ''}</span><span><b>{item.title}</b><small>{item.description}</small></span><span className="check-state">{item.done ? '완료' : '확인 필요'}</span></button>)}{!items.length && <div className="empty-line">체크리스트를 준비하는 중입니다.</div>}</div></section>
      <section className="space-section"><div className="section-heading"><div><div className="eyebrow">PROJECT RUNBOOK</div><h2>프로젝트별 운영지침</h2></div><button onClick={saveRunbook} disabled={runbookSaving} className="soft-button">{runbookSaving ? '저장 중...' : '운영지침 저장'}</button></div><textarea value={runbook} onChange={(event) => setRunbook(event.target.value)} className="runbook-editor" placeholder="이 프로젝트를 어떻게 운영하고 유지보수할지 적어두세요.\n\n예:\n- 변경 전 백업 생성\n- 테스트 실행 후 결과 확인\n- Skill 원본 파일은 직접 수정하지 않기" />{runbookMessage && <p className="text-xs text-blue-200 mt-3">{runbookMessage}</p>}</section>
      <section className="space-section"><div className="section-heading"><div><div className="eyebrow">LOCAL TIMELINE</div><h2>운영 타임라인</h2></div><span className="section-note">최근 100개 기록</span></div><div className="timeline-list">{activity.slice(0, 12).map((event) => <div key={event.id} className="timeline-row"><span className="timeline-dot" /><span><b>{event.title}</b><small>{event.description}</small></span><time>{new Date(event.createdAt).toLocaleString('ko-KR')}</time></div>)}{!activity.length && <div className="empty-line">아직 기록된 운영 활동이 없습니다.</div>}</div></section>
    </div>
  )
}
