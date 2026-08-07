import { useState } from 'react'
import { useScan } from '../stores/scanStore'

export function ChangesView() {
  const { roots, files } = useScan()
  const [report, setReport] = useState<any>(null)
  const [testResult, setTestResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const api = (window as any).electronAPI || {}
  const root = roots[0] || ''

  async function inspect() {
    if (!root) { setError('먼저 자료 스캔 화면에서 작업 폴더를 연결하세요.'); return }
    if (typeof api.getWorkspaceReport !== 'function') { setError('변경사항 확인 기능을 사용할 수 없습니다.'); return }
    setLoading(true)
    setError('')
    try {
      const result = await api.getWorkspaceReport(root)
      setReport(result)
      if (!result.success) setError(result.error || '작업 폴더의 변경사항을 확인하지 못했습니다.')
    } catch { setError('작업 폴더의 변경사항을 확인하지 못했습니다.') } finally { setLoading(false) }
  }

  async function runTests() {
    if (!root) { setError('먼저 자료 스캔 화면에서 작업 폴더를 연결하세요.'); return }
    if (typeof api.runWorkspaceTests !== 'function') { setError('테스트 실행 기능을 사용할 수 없습니다.'); return }
    setLoading(true)
    setError('')
    try {
      const result = await api.runWorkspaceTests(root)
      setTestResult(result)
      if (!result.success) setError(result.error || '테스트를 실행하지 못했습니다.')
    } catch { setError('테스트를 실행하지 못했습니다.') } finally { setLoading(false) }
  }

  return (
    <div className="page-wrap page-transition">
      <header className="page-hero"><div><div className="eyebrow">CHANGE CENTER</div><h1>무엇이 바뀌었나요?</h1><p>파일 변경과 테스트 결과를 확인한 뒤 다음 작업을 결정하세요.</p></div><div className="hero-actions"><button onClick={inspect} disabled={loading || !root} className="soft-button">{loading ? '확인 중...' : '변경사항 확인'}</button><button onClick={runTests} disabled={loading || !root} className="soft-button primary-button">테스트 실행</button></div></header>
      {!root && <div className="notice-line">연결된 작업 폴더가 없습니다. 자료 스캔 화면에서 폴더를 먼저 연결하세요.</div>}
      {error && <div className="notice-line">{error}</div>}
      <section className="metric-line"><div><span>읽은 파일</span><strong>{files.length}</strong></div><div><span>작업 폴더</span><strong className="small-metric">{root}</strong></div><div><span>테스트</span><strong className={testResult?.success ? 'status-good' : testResult ? 'status-bad' : ''}>{testResult ? (testResult.success ? '통과' : '실패') : '미실행'}</strong></div></section>
      <section className="split-section"><div className="section-heading"><div><div className="eyebrow">WORKSPACE DIFF</div><h2>변경 파일</h2></div><span className="section-note">Git 기준 · 원본은 수정하지 않음</span></div><pre className="output-panel">{report?.status || '변경사항 확인을 누르면 Git 변경 목록이 표시됩니다.'}</pre><pre className="output-panel subtle-output">{report?.diff || '변경 통계가 여기에 표시됩니다.'}</pre></section>
      <section className="split-section"><div className="section-heading"><div><div className="eyebrow">TEST RESULT</div><h2>테스트 결과</h2></div><span className="section-note">실행한 명령과 결과</span></div><pre className={`output-panel ${testResult?.success ? 'output-good' : testResult ? 'output-bad' : ''}`}>{testResult?.output || '테스트 실행 결과가 여기에 표시됩니다.'}</pre></section>
    </div>
  )
}
