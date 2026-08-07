import { useEffect, useState } from 'react'

export function BackupView() {
  const [backups, setBackups] = useState<any[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const api = (window as any).electronAPI || {}
  async function load() { try { if (typeof api.listBackups === 'function') setBackups(await api.listBackups()); setError('') } catch { setError('백업 목록을 불러오지 못했습니다.') } }
  useEffect(() => { load() }, [])
  async function create() { setBusy(true); try { const result = await api.backupDatabase(); setMessage(result.success ? `백업 완료: ${result.path}` : result.error); await load() } catch { setError('백업 생성에 실패했습니다.') } finally { setBusy(false) } }
  async function restore(name: string) { if (!window.confirm(`${name} 백업으로 복구할까요? 복구 전 현재 상태도 자동 백업됩니다.`)) return; setBusy(true); try { const result = await api.restoreBackup(name); setMessage(result.success ? `복구 완료. 안전 백업: ${result.safetyBackup}` : result.error); await load() } catch { setError('백업 복구에 실패했습니다.') } finally { setBusy(false) } }

  return (
    <div className="page-wrap page-transition">
      <header className="page-hero"><div><div className="eyebrow">BACKUP ROOM</div><h1>안전하게 저장하고 되돌리기</h1><p>복구 전에 현재 데이터도 자동으로 백업하여 실수를 되돌릴 수 있게 합니다.</p></div><button onClick={create} disabled={busy} className="soft-button primary-button">{busy ? '처리 중...' : '💾 지금 백업'}</button></header>
      {error && <div className="notice-line">{error} <button onClick={load} className="text-link">다시 시도</button></div>}
      {message && <div className="notice-line">{message}</div>}
      <section className="space-section"><div className="section-heading"><div><div className="eyebrow">LOCAL SNAPSHOTS</div><h2>백업 목록</h2></div><span className="section-note">API 키가 포함될 수 있습니다</span></div><div className="backup-list">{backups.map((backup) => <div key={backup.name} className="backup-row"><span className="backup-icon">◒</span><span><b>{backup.name}</b><small>{new Date(backup.updatedAt).toLocaleString('ko-KR')} · {(backup.size / 1024).toFixed(1)} KB</small></span><button onClick={() => restore(backup.name)} disabled={busy} className="text-link">이 백업으로 복구</button></div>)}{!backups.length && <div className="empty-line">생성된 백업이 없습니다.</div>}</div></section>
      <section className="warning-strip"><b>백업 파일 주의</b><span>API 키를 로컬 SQLite에 저장한 경우 백업 파일에도 포함될 수 있습니다. 다른 사람에게 공유하지 마세요.</span></section>
    </div>
  )
}
