import { useEffect, useMemo, useState } from 'react'

const initial = { title: '', goal: '', scope: '', references: '', acceptance: '', forbidden: '' }

export function TaskRequestView() {
  const [form, setForm] = useState(initial)
  const [saved, setSaved] = useState<any[]>([])
  const [message, setMessage] = useState('')
  const api = (window as any).electronAPI || {}
  const content = useMemo(() => `# Agent 작업 요청서\n\n## 목표\n${form.goal || '(목표를 입력하세요)'}\n\n## 작업 범위\n${form.scope || '(수정 범위를 입력하세요)'}\n\n## 참고 자료\n${form.references || '(참고 파일이나 문서를 입력하세요)'}\n\n## 완료 조건\n${form.acceptance || '(완료 조건을 입력하세요)'}\n\n## 금지 사항\n${form.forbidden || '(건드리면 안 되는 것을 입력하세요)'}\n`, [form])

  useEffect(() => { if (typeof api.listTaskRequests === 'function') api.listTaskRequests().then(setSaved) }, [])
  function update(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })) }
  async function save() { if (!form.title.trim() || !form.goal.trim()) { setMessage('제목과 목표를 입력하세요.'); return }; const result = typeof api.saveTaskRequest === 'function' ? await api.saveTaskRequest({ ...form, content }) : { ...form, content, id: crypto.randomUUID() }; setSaved((current) => [result, ...current]); setMessage('요청서를 저장했습니다.') }
  async function copy() { await navigator.clipboard?.writeText(content); setMessage('요청서를 클립보드에 복사했습니다.') }

  return (
    <div className="page-wrap page-transition">
      <header className="page-hero"><div><div className="eyebrow">AGENT REQUEST ROOM</div><h1>Agent에게 어떻게 부탁할까요?</h1><p>다섯 가지 정보만 채우면 명확하고 안전한 작업 요청서가 만들어집니다.</p></div><div className="hero-actions"><button onClick={copy} className="soft-button">복사</button><button onClick={save} className="soft-button primary-button">저장</button></div></header>
      {message && <div className="notice-line">{message}</div>}
      <div className="request-layout"><section className="request-form space-section"><div className="section-heading"><div><div className="eyebrow">REQUEST BUILDER</div><h2>요청 내용</h2></div></div><label>요청서 이름<input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="예: 운영센터 유지보수 화면 만들기" /></label><label>목표<textarea value={form.goal} onChange={(e) => update('goal', e.target.value)} placeholder="무엇을 만들거나 고칠지" /></label><label>작업 범위<textarea value={form.scope} onChange={(e) => update('scope', e.target.value)} placeholder="어떤 파일·화면·폴더까지 작업할지" /></label><label>참고 자료<textarea value={form.references} onChange={(e) => update('references', e.target.value)} placeholder="관련 파일, 문서, 기존 기능" /></label><label>완료 조건<textarea value={form.acceptance} onChange={(e) => update('acceptance', e.target.value)} placeholder="무엇을 통과하면 완료인지" /></label><label>금지 사항<textarea value={form.forbidden} onChange={(e) => update('forbidden', e.target.value)} placeholder="수정하지 말아야 할 파일이나 범위" /></label></section><section className="request-preview space-section"><div className="section-heading"><div><div className="eyebrow">PREVIEW</div><h2>미리보기</h2></div></div><pre className="request-output">{content}</pre></section></div>
      <section className="space-section"><div className="section-heading"><div><div className="eyebrow">SAVED REQUESTS</div><h2>저장한 요청서</h2></div><span className="section-note">{saved.length}개</span></div><div className="saved-request-list">{saved.slice(0, 8).map((item) => <button key={item.id} onClick={() => setForm({ title: item.title, goal: item.goal, scope: item.scope, references: item.referenceText || item.references || '', acceptance: item.acceptance, forbidden: item.forbidden })} className="saved-request-row"><b>{item.title}</b><span>{new Date(item.createdAt || Date.now()).toLocaleString('ko-KR')}</span><i>↗</i></button>)}{!saved.length && <div className="empty-line">저장한 요청서가 없습니다.</div>}</div></section>
    </div>
  )
}
