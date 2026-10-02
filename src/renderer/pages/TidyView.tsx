import { useCallback, useEffect, useState } from 'react'
import { repoLine, repoNeedsAttention } from '../../core/tidy/git-leftovers'
import { processIsOld, processLine } from '../../core/tidy/background-jobs'
import { KIND_LABEL, heavyIsStale, heavyLine } from '../../core/tidy/space-hogs'
import { emptyLine, sectionTitle, tidyHeadline } from '../../core/tidy/tidy-copy'
import { tidyApi, type HeadlessProcess, type HeavyFolder, type RepoLeftover, type ScheduledJob, type TidyReport } from './tidy-api'
import { whenText } from './skill-board-api'

type Notice = { ok: boolean; text: string } | null
/** A destructive button waits for one more press; this remembers which row is waiting. */
type Confirm = { kind: 'stop'; pid: number } | { kind: 'trash'; path: string } | null

const JOB_KIND: Record<ScheduledJob['kind'], string> = { cron: 'cron 예약', systemd: 'systemd 타이머', schtasks: 'Windows 작업 스케줄러' }

function dateText(ms: number): string {
  if (!ms) return ''
  const date = new Date(ms)
  const sameDay = new Date().toDateString() === date.toDateString()
  const clock = `${date.getHours()}시 ${String(date.getMinutes()).padStart(2, '0')}분`
  return sameDay ? `오늘 ${clock}` : `${date.getMonth() + 1}월 ${date.getDate()}일 ${clock}`
}

/**
 * 정리: what a non-developer's computer collects while developing — unsaved git work,
 * dev servers left running, scheduled jobs, and folders that only take up space.
 * The screen only looks; the three buttons that change anything (끄기, 휴지통으로, 기록 지우기)
 * each ask once more inline before they act.
 */
export function TidyView() {
  const [report, setReport] = useState<TidyReport | null>(null)
  const [failed, setFailed] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)

  const load = useCallback(async (refresh: boolean) => {
    const api = tidyApi()
    if (!api) {
      setFailed('이 화면은 Dios 앱에서 열려요.')
      return
    }
    setScanning(true)
    try {
      setReport(await api.tidyReport(refresh))
      setFailed('')
    } catch {
      setFailed('컴퓨터를 살펴보지 못했어요. 다시 시도해 주세요.')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => { void load(false) }, [load])

  async function addFolder() {
    const api = tidyApi()
    if (!api?.apiKeysAddScanRoot) return
    try {
      const result = await api.apiKeysAddScanRoot()
      if (result.ok) await load(true)
      else if (result.message) setNotice({ ok: false, text: result.message })
    } catch {
      setNotice({ ok: false, text: '폴더를 고르지 못했어요.' })
    }
  }

  async function open(target: string) {
    const api = tidyApi()
    if (!api) return
    try {
      const result = await api.tidyOpen(target)
      if (!result.ok) setNotice({ ok: false, text: result.message })
    } catch {
      setNotice({ ok: false, text: '폴더를 열지 못했어요.' })
    }
  }

  async function stop(pid: number) {
    const api = tidyApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.tidyStop(pid)
      setNotice({ ok: result.ok, text: result.message })
      if (result.ok) setReport((current) => (current ? { ...current, processes: current.processes.filter((proc) => proc.pid !== pid) } : current))
    } catch {
      setNotice({ ok: false, text: '끄지 못했어요.' })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function trash(target: string) {
    const api = tidyApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.tidyTrash(target)
      setNotice({ ok: result.ok, text: result.message })
      if (result.ok) setReport((current) => (current ? { ...current, heavy: current.heavy.filter((row) => row.path !== target) } : current))
    } catch {
      setNotice({ ok: false, text: '휴지통으로 보내지 못했어요.' })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function prune(repo: string) {
    const api = tidyApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.tidyPruneWorktrees(repo)
      setNotice({ ok: result.ok, text: result.message })
      if (result.ok && result.repo) {
        const fresh = result.repo
        setReport((current) => (current ? { ...current, repos: current.repos.map((row) => (row.repo === repo ? fresh : row)) } : current))
      }
    } catch {
      setNotice({ ok: false, text: '기록을 지우지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }

  if (failed) {
    return (
      <section className="skill-board">
        <p className="skill-lead">{failed}</p>
        {tidyApi() && <button type="button" className="skill-action" onClick={() => void load(false)}>다시 시도</button>}
      </section>
    )
  }
  if (!report) {
    return (
      <section className="skill-board" aria-busy="true">
        <p className="skill-lead">컴퓨터를 살펴보고 있어요.</p>
        <p className="skill-quiet">프로젝트 폴더마다 저장 안 한 수정이 있는지, 창 없이 켜진 프로그램이 있는지, 자리만 차지하는 폴더가 있는지 봐요. 프로젝트가 많으면 1분쯤 걸려요.</p>
      </section>
    )
  }

  const attention = report.repos.filter(repoNeedsAttention).length
  const oldProcesses = report.processes.filter((proc) => processIsOld(proc)).length
  const stale = report.heavy.filter((row) => heavyIsStale(row)).length

  return (
    <section className="skill-board" aria-label="정리">
      <header className="skill-top">
        <p className="skill-lead">{tidyHeadline(report)}</p>
        <div className="skill-toolbar">
          <button type="button" className="skill-action primary" disabled={scanning} onClick={() => void load(true)}>
            {scanning ? '살펴보는 중…' : '다시 살펴보기'}
          </button>
          {tidyApi()?.apiKeysAddScanRoot && (
            <button type="button" className="skill-action" disabled={scanning} onClick={() => void addFolder()}>폴더 더 고르기</button>
          )}
        </div>
      </header>

      <p className="skill-quiet">
        {report.roots.length ? `폴더 ${report.roots.length}곳을 훑었어요` : '아직 훑는 폴더가 없어요'}
        {report.scannedAt > 0 && ` · 마지막으로 살펴본 때 ${whenText(report.scannedAt)}`}
        {' · 이 화면은 보기만 해요. 끄기와 휴지통은 누른 것만, 한 번 더 물어보고 해요.'}
      </p>

      {report.notes.map((note) => <p key={note} className="notice-line" role="status">{note}</p>)}

      {notice && <p className={notice.ok ? 'skill-toast ok' : 'skill-toast bad'} role="status">{notice.text}</p>}

      <section className="skill-card scan-report" aria-label="저장 안 한 수정">
        <header className="scan-report-head">
          <b>{sectionTitle('repos', report.repos.length)}</b>
          {report.repos.length > 0 && <small>{attention ? `볼 것 ${attention}곳` : '전부 깨끗해요'}</small>}
        </header>
        {report.repos.length === 0 ? (
          <p className="skill-quiet">{emptyLine('repos', report.roots.length)}</p>
        ) : (
          <ul className="scan-rows">
            {report.repos.map((repo) => <RepoRow key={repo.repo} repo={repo} busy={busy} onOpen={open} onPrune={prune} />)}
          </ul>
        )}
      </section>

      <section className="skill-card scan-report" aria-label="창 없이 켜져 있는 프로그램">
        <header className="scan-report-head">
          <b>{sectionTitle('processes', report.processes.length)}</b>
          {oldProcesses > 0 && <small>하루 넘게 켜진 것 {oldProcesses}개</small>}
        </header>
        {report.processes.length === 0 ? (
          <p className="skill-quiet">{emptyLine('processes', report.roots.length)}</p>
        ) : (
          <ul className="scan-rows">
            {report.processes.map((proc) => (
              <ProcessRow
                key={proc.pid}
                proc={proc}
                busy={busy}
                asking={confirm?.kind === 'stop' && confirm.pid === proc.pid}
                onAsk={() => setConfirm({ kind: 'stop', pid: proc.pid })}
                onCancel={() => setConfirm(null)}
                onStop={() => void stop(proc.pid)}
                onOpen={open}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="skill-card scan-report" aria-label="자리만 차지하는 폴더">
        <header className="scan-report-head">
          <b>{sectionTitle('heavy', report.heavy.length)}</b>
          {stale > 0 && <small>한 달 넘게 안 쓴 프로젝트 것 {stale}곳</small>}
        </header>
        {report.heavy.length === 0 ? (
          <p className="skill-quiet">{emptyLine('heavy', report.roots.length)}</p>
        ) : (
          <ul className="scan-rows">
            {report.heavy.map((row) => (
              <HeavyRow
                key={row.path}
                row={row}
                busy={busy}
                asking={confirm?.kind === 'trash' && confirm.path === row.path}
                onAsk={() => setConfirm({ kind: 'trash', path: row.path })}
                onCancel={() => setConfirm(null)}
                onTrash={() => void trash(row.path)}
                onOpen={open}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="skill-card scan-report" aria-label="혼자 도는 예약 작업">
        <header className="scan-report-head">
          <b>{sectionTitle('jobs', report.jobs.length)}</b>
          {report.jobs.length > 0 && <small>보기만 해요</small>}
        </header>
        {report.jobs.length === 0 ? (
          <p className="skill-quiet">{emptyLine('jobs', report.roots.length)}</p>
        ) : (
          <ul className="scan-rows">
            {report.jobs.map((job, index) => <JobRow key={`${job.kind}-${job.name}-${index}`} job={job} />)}
          </ul>
        )}
      </section>
    </section>
  )
}

function RepoRow({ repo, busy, onOpen, onPrune }: { repo: RepoLeftover; busy: boolean; onOpen: (target: string) => void; onPrune: (repo: string) => void }) {
  const state = repo.failed ? 'is-missing' : repoNeedsAttention(repo) ? 'is-found' : 'is-empty'
  const gone = repo.worktrees.filter((tree) => tree.prunable || !tree.exists)
  return (
    <li className={`scan-row ${state}`}>
      <i aria-hidden="true" />
      <div className="scan-row-main">
        <b className="tidy-title">{repo.name}{repo.branch && <span className="ju-meta tidy-branch">{repo.branch}</span>}</b>
        <code>{repo.repo}</code>
        <small className="is-why">{repoLine(repo)}{repo.lastCommitAt > 0 && ` · 마지막 저장 ${whenText(repo.lastCommitAt)}`}</small>
        {repo.partOf && <small>{repo.partOf.split(/[\\/]/).pop()} 프로젝트에서 따로 꺼내 둔 작업 폴더예요.</small>}
        {repo.worktrees.length > 0 && <WorktreeList trees={repo.worktrees} onOpen={onOpen} />}
      </div>
      <div className="scan-row-actions">
        <button type="button" className="skill-link" onClick={() => onOpen(repo.repo)}>열기</button>
        {gone.length > 0 && <button type="button" className="skill-link" disabled={busy} onClick={() => onPrune(repo.repo)}>사라진 기록 지우기</button>}
      </div>
    </li>
  )
}

function WorktreeList({ trees, onOpen }: { trees: RepoLeftover['worktrees']; onOpen: (target: string) => void }) {
  const list = (
    <ul className="tidy-sub">
      {trees.map((tree) => (
        <li key={tree.path}>
          <code>{tree.path}</code>
          <small>{tree.branch || '가지 없음'}{(tree.prunable || !tree.exists) ? ' · 폴더가 없어요' : ''}</small>
          {tree.exists && <button type="button" className="skill-link" onClick={() => onOpen(tree.path)}>열기</button>}
        </li>
      ))}
    </ul>
  )
  if (trees.length <= 3) return list
  return (
    <details className="skill-raw">
      <summary>작업 폴더 {trees.length}곳 보기</summary>
      {list}
    </details>
  )
}

function ProcessRow({ proc, busy, asking, onAsk, onCancel, onStop, onOpen }: {
  proc: HeadlessProcess
  busy: boolean
  asking: boolean
  onAsk: () => void
  onCancel: () => void
  onStop: () => void
  onOpen: (target: string) => void
}) {
  return (
    <li className={`scan-row ${processIsOld(proc) ? 'is-found' : 'is-empty'}`}>
      <i aria-hidden="true" />
      <div className="scan-row-main">
        <b className="tidy-title">{proc.summary}<span className="ju-meta tidy-branch">{proc.name} · pid {proc.pid}</span></b>
        <small className="is-why">{processLine(proc)}</small>
        <details className="skill-raw">
          <summary>실행 명령 보기</summary>
          <code>{proc.args}</code>
        </details>
      </div>
      <div className="scan-row-actions">
        {asking ? (
          <span className="tidy-confirm" role="alertdialog" aria-label="끄기 확인">
            <small>정말 끌까요? 저장 안 한 것이 있으면 사라져요.</small>
            <button type="button" className="skill-action tidy-danger" disabled={busy} onClick={onStop}>끄기</button>
            <button type="button" className="skill-link" disabled={busy} onClick={onCancel}>취소</button>
          </span>
        ) : (
          <>
            {proc.cwd && <button type="button" className="skill-link" onClick={() => onOpen(proc.cwd)}>폴더 열기</button>}
            <button type="button" className="skill-link" disabled={busy} onClick={onAsk}>끄기</button>
          </>
        )}
      </div>
    </li>
  )
}

function HeavyRow({ row, busy, asking, onAsk, onCancel, onTrash, onOpen }: {
  row: HeavyFolder
  busy: boolean
  asking: boolean
  onAsk: () => void
  onCancel: () => void
  onTrash: () => void
  onOpen: (target: string) => void
}) {
  const canTrash = row.kind !== 'temp'
  return (
    <li className={`scan-row ${heavyIsStale(row) ? 'is-found' : 'is-empty'}`}>
      <i aria-hidden="true" />
      <div className="scan-row-main">
        <b className="tidy-title">{KIND_LABEL[row.kind]}{row.project && <span className="ju-meta tidy-branch">{row.project.split(/[\\/]/).pop()}</span>}</b>
        <code>{row.path}</code>
        <small className="is-why">{heavyLine(row)}</small>
      </div>
      <div className="scan-row-actions">
        {asking ? (
          <span className="tidy-confirm" role="alertdialog" aria-label="휴지통 확인">
            <small>휴지통으로 보낼까요? 휴지통에서 되돌릴 수 있어요.</small>
            <button type="button" className="skill-action tidy-danger" disabled={busy} onClick={onTrash}>휴지통으로</button>
            <button type="button" className="skill-link" disabled={busy} onClick={onCancel}>취소</button>
          </span>
        ) : (
          <>
            <button type="button" className="skill-link" onClick={() => onOpen(row.path)}>열기</button>
            {canTrash && <button type="button" className="skill-link" disabled={busy} onClick={onAsk}>휴지통으로</button>}
          </>
        )}
      </div>
    </li>
  )
}

function JobRow({ job }: { job: ScheduledJob }) {
  const when = [job.lastRunAt ? `마지막 실행 ${whenText(job.lastRunAt)}` : '', job.nextRunAt ? `다음 ${dateText(job.nextRunAt)}` : ''].filter(Boolean).join(' · ')
  return (
    <li className={`scan-row ${job.enabled ? 'is-empty' : 'is-missing'}`}>
      <i aria-hidden="true" />
      <div className="scan-row-main">
        <b className="tidy-title">{job.name}<span className="ju-meta tidy-branch">{JOB_KIND[job.kind]}</span></b>
        <small className="is-why">{job.schedule}{when && ` · ${when}`}{!job.enabled && ' · 꺼져 있어요'}</small>
        {job.command && (
          <details className="skill-raw">
            <summary>실행 명령 보기</summary>
            <code>{job.command}</code>
          </details>
        )}
      </div>
    </li>
  )
}
