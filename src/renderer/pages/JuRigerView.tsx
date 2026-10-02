import { useCallback, useEffect, useState } from 'react'
import { bridgeStatusLine, jurigerHeadline, repeatsLine, runResultLine, severityLine, skillStatusLine, weekMinutesLine } from '../../core/juriger/juriger-copy'
import { skillCanRun, type BridgeRead, type JurigerAction, type JurigerRecentRun, type JurigerSkill, type JurigerSuggestion } from '../../core/juriger/read-bridge'
import { jurigerApi } from './juriger-api'
import { whenText } from './skill-board-api'

type Notice = { ok: boolean; text: string } | null

function isBridgeRead(value: unknown): value is BridgeRead {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'missing' || kind === 'unreadable' || kind === 'unsupported' || kind === 'ready'
}

function dotClass(view: BridgeRead): string {
  if (view.kind !== 'ready') return 'is-off'
  if (view.freshness === 'offline') return 'is-off'
  if (view.freshness === 'stale') return 'is-wait'
  if (view.state.status === 'error') return 'is-bad'
  if (view.state.status === 'paused') return 'is-idle'
  return 'is-live'
}

/**
 * JuRiger dashboard. DIOS only shows the bridge file and sends a command the Founder pressed.
 * JuRiger decides whether a skill can actually run.
 */
export function JuRigerView() {
  const [view, setView] = useState<BridgeRead | null>(null)
  const [failed, setFailed] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState('')
  const [openDetail, setOpenDetail] = useState('')

  const apply = useCallback((next: unknown) => {
    if (isBridgeRead(next)) {
      setView(next)
      setFailed('')
    }
  }, [])

  const load = useCallback(async () => {
    const api = jurigerApi()
    if (!api) {
      setFailed('이 화면은 Dios 앱에서 열려요.')
      return
    }
    try {
      apply(await api.jurigerState())
    } catch {
      setFailed('JuRiger 상태를 읽지 못했어요. 다시 시도해 주세요.')
    }
  }, [apply])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const api = jurigerApi()
    if (!api?.onJuriger) return
    return api.onJuriger(apply)
  }, [apply])

  async function send(action: JurigerAction, targetId: string) {
    const api = jurigerApi()
    if (!api) return
    setBusy(`${action}:${targetId}`)
    try {
      const result = await api.jurigerCommand(action, targetId)
      setNotice({ ok: result.ok, text: result.ok ? 'JuRiger에 보냈어요.' : result.message })
    } catch {
      setNotice({ ok: false, text: '보내지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy('')
    }
  }

  if (failed) {
    return (
      <section className="skill-board">
        <p className="skill-lead">{failed}</p>
        {jurigerApi() && <button type="button" className="skill-action" onClick={() => void load()}>다시 시도</button>}
      </section>
    )
  }
  if (!view) {
    return <section className="skill-board" aria-busy="true"><p className="skill-lead">JuRiger 상태를 읽고 있어요.</p></section>
  }

  const ready = view.kind === 'ready' ? view : null
  const fresh = ready?.freshness === 'fresh'
  const state = ready?.state
  const headline = jurigerHeadline(view)
  const status = bridgeStatusLine(view)

  return (
    <section className="skill-board" aria-label="JuRiger">
      <header className="skill-top">
        <div>
          {headline !== status && <p className="skill-lead">{headline}</p>}
          <p className={`${headline === status ? 'skill-lead' : 'juriger-status'} juriger-with-dot`}><i className={`juriger-dot ${dotClass(view)}`} aria-hidden="true" />{status}</p>
        </div>
        <div className="skill-toolbar">
          {view.kind !== 'missing' && (
            <button type="button" className="skill-action primary" disabled={busy !== ''} onClick={() => void send('open_juriger', '')}>JuRiger 열기</button>
          )}
          <button type="button" className="skill-action" onClick={() => void load()}>다시 읽기</button>
        </div>
      </header>

      {notice && <p className={notice.ok ? 'skill-toast ok' : 'skill-toast bad'} role="status">{notice.text}</p>}

      {state && (
        <section className="skill-card juriger-counts" aria-label="요약">
          <p><small>새 Skill 제안</small><b>{state.newSuggestionCount}</b></p>
          <p><small>등록된 Skill</small><b>{state.skills.length}</b></p>
          <p><small>이번 주 예상 절약</small><b>{state.savedMinutesThisWeek}분</b></p>
        </section>
      )}

      <section className="skill-card scan-report" aria-label="새 제안">
        <header className="scan-report-head"><b>새 제안</b></header>
        {!state || state.suggestions.length === 0 ? (
          <p className="skill-quiet">{fresh ? '새 제안이 없어요.' : bridgeStatusLine(view)}</p>
        ) : (
          <ul className="scan-rows">
            {state.suggestions.map((item) => (
              <SuggestionRow
                key={item.id}
                item={item}
                fresh={Boolean(fresh)}
                busy={busy === `accept_suggestion:${item.id}` || busy === `dismiss_suggestion:${item.id}`}
                open={openDetail === item.id}
                onToggle={() => setOpenDetail((current) => (current === item.id ? '' : item.id))}
                onAccept={() => void send('accept_suggestion', item.id)}
                onDismiss={() => void send('dismiss_suggestion', item.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="skill-card scan-report" aria-label="등록된 Skill">
        <header className="scan-report-head"><b>등록된 Skill</b></header>
        {!state || state.skills.length === 0 ? (
          <p className="skill-quiet">{fresh ? '등록된 Skill이 없어요.' : bridgeStatusLine(view)}</p>
        ) : (
          <ul className="scan-rows">
            {state.skills.map((skill) => (
              <SkillRow key={skill.id} skill={skill} fresh={Boolean(fresh)} busy={busy === `run_skill:${skill.id}`} onRun={() => void send('run_skill', skill.id)} />
            ))}
          </ul>
        )}
      </section>

      <section className="skill-card scan-report" aria-label="최근 실행">
        <header className="scan-report-head"><b>최근 실행</b></header>
        {!state || state.recentRuns.length === 0 ? (
          <p className="skill-quiet">{fresh ? '최근 실행이 없어요.' : bridgeStatusLine(view)}</p>
        ) : (
          <ul className="scan-rows">
            {state.recentRuns.map((run, index) => <RunRow key={run.id || `${run.title}-${index}`} run={run} />)}
          </ul>
        )}
      </section>
    </section>
  )
}

function SuggestionRow({ item, fresh, busy, open, onToggle, onAccept, onDismiss }: {
  item: JurigerSuggestion
  fresh: boolean
  busy: boolean
  open: boolean
  onToggle: () => void
  onAccept: () => void
  onDismiss: () => void
}) {
  const severity = severityLine(item.severity)
  return (
    <li className="scan-row is-found">
      <i aria-hidden="true" />
      <div className="scan-row-main">
        <b className="tidy-title">{item.title || '이름 없는 제안'}</b>
        <small className="is-why">{repeatsLine(item.occurrenceCount)}{severity ? ` · ${severity}` : ''}</small>
        <small>예상 절약 {weekMinutesLine(item.estimatedSavedMinutesPerWeek)}</small>
        {open && (
          <div className="juriger-detail">
            {item.plainSummary && <p>{item.plainSummary}</p>}
            {item.whyItMayHelp && <p>{item.whyItMayHelp}</p>}
            {item.suggestedSkillName && <p>제안 이름 · {item.suggestedSkillName}</p>}
          </div>
        )}
      </div>
      <div className="scan-row-actions">
        <button type="button" className="skill-link" aria-expanded={open} onClick={onToggle}>{open ? '접기' : '자세히'}</button>
        <button type="button" className="skill-action primary" disabled={!fresh || busy} onClick={onAccept}>수락</button>
        <button type="button" className="skill-link" disabled={!fresh || busy} onClick={onDismiss}>무시</button>
      </div>
    </li>
  )
}

function SkillRow({ skill, fresh, busy, onRun }: { skill: JurigerSkill; fresh: boolean; busy: boolean; onRun: () => void }) {
  const when = skill.lastRun?.at ? Date.parse(skill.lastRun.at) : 0
  const last = skill.lastRun ? `마지막 실행 ${when ? whenText(when) : ''} ${runResultLine(skill.lastRun.result)}`.replace(/\s+/g, ' ').trim() : ''
  return (
    <li className={`scan-row ${skill.status === 'failed' ? 'is-missing' : skill.status === 'ready' ? 'is-found' : 'is-empty'}`}>
      <i aria-hidden="true" />
      <div className="scan-row-main">
        <b className="tidy-title">{skill.name || '이름 없는 Skill'}<span className="ju-meta tidy-branch">{skillStatusLine(skill.status)}</span></b>
        {last && <small className="is-why">{last}{skill.lastRun?.note ? ` · ${skill.lastRun.note}` : ''}</small>}
      </div>
      <div className="scan-row-actions">
        <button type="button" className="skill-action primary" disabled={!fresh || busy || !skillCanRun(skill.status)} onClick={onRun}>실행</button>
      </div>
    </li>
  )
}

function RunRow({ run }: { run: JurigerRecentRun }) {
  const when = run.at ? Date.parse(run.at) : 0
  return (
    <li className={`scan-row ${run.result === 'failed' ? 'is-missing' : 'is-empty'}`}>
      <i aria-hidden="true" />
      <div className="scan-row-main">
        <b className="tidy-title">{run.title || '실행'}<span className="ju-meta tidy-branch">{runResultLine(run.result)}</span></b>
        <small className="is-why">{[when ? whenText(when) : '', run.note].filter(Boolean).join(' · ')}</small>
      </div>
    </li>
  )
}
