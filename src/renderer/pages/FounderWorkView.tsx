import { useCallback, useEffect, useRef, useState } from 'react'
import { workHeadline, type OpenTask, type PastTask } from '../../core/founder-work/parse-gate'
import { WORK_HOLD_LINE, isWorkListOn } from '../../core/founder-work/work-hold'
import { whenText } from './skill-board-api'

interface FounderWork {
  found: boolean
  open: OpenTask[]
  done: PastTask[]
  blocked: PastTask[]
}

interface WorkResult {
  ok: boolean
  message: string
  undoId?: string
  work: FounderWork
}

interface WorkApi {
  founderWorkList: () => Promise<FounderWork>
  founderWorkDismiss: (kind: 'aside' | 'founder', fileName: string) => Promise<WorkResult>
  founderWorkFinish: (kind: 'aside' | 'founder', fileName: string, note: string) => Promise<WorkResult>
  founderWorkUndo: (undoId: string) => Promise<WorkResult>
  founderWorkCopy: (text: string) => Promise<{ ok: boolean }>
  onFounderWork: (callback: (work: FounderWork) => void) => () => void
}

const SEEN_KEY = 'dios.work.seen'
const EMPTY: FounderWork = { found: false, open: [], done: [], blocked: [] }

function workApi(): WorkApi | null {
  const api = (window as unknown as { electronAPI?: Partial<WorkApi> }).electronAPI
  return api?.founderWorkList ? (api as WorkApi) : null
}

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

function writeSeen(files: Iterable<string>): void {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...files]))
}

/**
 * What the Founder has to do now and what already finished.
 * The list is the same one the founder-gate-relay skill writes on MainPC; DIOS shows it and files results.
 */
export function FounderWorkView() {
  const [work, setWork] = useState<FounderWork | null>(null)
  const [failed, setFailed] = useState('')
  const [notice, setNotice] = useState('')
  const [undoId, setUndoId] = useState('')
  const [pastOpen, setPastOpen] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(() => readSeen())
  const seenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = !isWorkListOn(typeof window === 'undefined' ? null : window.localStorage)

  const apply = useCallback((listed: FounderWork) => {
    setWork(listed)
    setFailed(listed.found ? '' : '이 컴퓨터에서는 할 일 목록을 찾지 못했어요. MainPC에서 열어 주세요.')
  }, [])

  const load = useCallback(async () => {
    const api = workApi()
    if (!api) {
      setFailed('이 화면은 Dios 앱에서 열려요.')
      setWork(EMPTY)
      return
    }
    try {
      apply(await api.founderWorkList())
    } catch {
      setFailed('할 일 목록을 읽지 못했어요.')
      setWork(EMPTY)
    }
  }, [apply])

  useEffect(() => {
    void load()
    const api = workApi()
    return api?.onFounderWork ? api.onFounderWork(apply) : undefined
  }, [load, apply])

  // New arrivals keep their tag for a moment, then count as seen.
  useEffect(() => {
    if (!work) return
    const files = work.open.map((task) => `${task.kind}/${task.fileName}`)
    if (files.every((file) => seen.has(file))) return
    if (seenTimer.current) clearTimeout(seenTimer.current)
    seenTimer.current = setTimeout(() => {
      const next = new Set(files)
      writeSeen(next)
      setSeen(next)
    }, 12_000)
    return () => { if (seenTimer.current) clearTimeout(seenTimer.current) }
  }, [work, seen])

  function settle(result: WorkResult) {
    setWork(result.work)
    setNotice(result.message)
    setUndoId(result.ok ? result.undoId || '' : '')
  }

  async function dismiss(task: OpenTask) {
    const api = workApi()
    if (!api) return
    try {
      settle(await api.founderWorkDismiss(task.kind, task.fileName))
    } catch {
      setNotice('지우지 못했어요. 잠시 뒤 다시 눌러 주세요.')
      setUndoId('')
    }
  }

  async function finish(task: OpenTask, note: string) {
    const api = workApi()
    if (!api) return
    try {
      settle(await api.founderWorkFinish(task.kind, task.fileName, note))
    } catch {
      setNotice('옮기지 못했어요. 잠시 뒤 다시 눌러 주세요.')
      setUndoId('')
    }
  }

  async function undo() {
    const api = workApi()
    if (!api || !undoId) return
    try {
      const result = await api.founderWorkUndo(undoId)
      setWork(result.work)
      setNotice(result.message)
      setUndoId('')
    } catch {
      setNotice('되돌리지 못했어요.')
    }
  }

  async function copy(text: string, what: string) {
    const api = workApi()
    try {
      if (api?.founderWorkCopy) await api.founderWorkCopy(text)
      else await navigator.clipboard.writeText(text)
      setNotice(`${what} 복사했어요. 붙여 넣으면 돼요.`)
      setUndoId('')
    } catch {
      setNotice('복사하지 못했어요. 글을 직접 골라 주세요.')
    }
  }

  if (work === null) {
    return <section className="skill-board"><p className="skill-lead">할 일을 읽고 있어요.</p></section>
  }

  const aside = work.open.filter((task) => task.kind === 'aside')
  const founder = work.open.filter((task) => task.kind === 'founder')
  const fresh = work.open.filter((task) => !seen.has(`${task.kind}/${task.fileName}`)).length

  return (
    <section className="skill-board" aria-label="지금 할 일">
      {held && <p className="notice-line" role="status">{WORK_HOLD_LINE}</p>}
      <header className="skill-top">
        <div>
          <p className="skill-lead">{failed || workHeadline(aside.length, founder.length)}</p>
          {!failed && (
            <p className="skill-quiet">
              {fresh > 0 ? `새로 온 일 ${fresh}개. ` : ''}
              새 일이 오면 이 화면이 알아서 바뀌어요. 결과를 붙여 넣으면 끝난 일로 옮겨지고, 시킨 에이전트에게도 전해져요.
            </p>
          )}
        </div>
        <div className="skill-toolbar">
          <button type="button" className="skill-action" onClick={() => void load()}>지금 다시 읽기</button>
        </div>
      </header>

      {notice && (
        <p className="skill-toast ok" role="status">
          {notice}
          {undoId && <button type="button" className="skill-link" onClick={() => void undo()}>되돌리기</button>}
        </p>
      )}

      {aside.length > 0 && (
        <section aria-label="Aside에게 말할 일">
          <h2 className="work-head">Aside에게 말할 일</h2>
          <div className="key-groups">
            {aside.map((task) => (
              <TaskCard key={`${task.kind}-${task.fileName}`} task={task} fresh={!seen.has(`${task.kind}/${task.fileName}`)} onCopy={copy} onDismiss={dismiss} onFinish={finish} />
            ))}
          </div>
        </section>
      )}

      {founder.length > 0 && (
        <section aria-label="직접 할 일">
          <h2 className="work-head">직접 하실 일</h2>
          <div className="key-groups">
            {founder.map((task) => (
              <TaskCard key={`${task.kind}-${task.fileName}`} task={task} fresh={!seen.has(`${task.kind}/${task.fileName}`)} onCopy={copy} onDismiss={dismiss} onFinish={finish} />
            ))}
          </div>
        </section>
      )}

      {(work.done.length > 0 || work.blocked.length > 0) && (
        <details className="skill-raw" open={pastOpen} onToggle={(event) => setPastOpen((event.target as HTMLDetailsElement).open)}>
          <summary>끝난 일 {work.done.length}개 · 다시 해야 하는 일 {work.blocked.length}개</summary>
          <PastList title="끝난 일" items={work.done} />
          <PastList title="다시 해야 하는 일" items={work.blocked} />
        </details>
      )}
    </section>
  )
}

interface TaskCardProps {
  task: OpenTask
  fresh: boolean
  onCopy: (text: string, what: string) => void
  onDismiss: (task: OpenTask) => void
  onFinish: (task: OpenTask, note: string) => void
}

function TaskCard({ task, fresh, onCopy, onDismiss, onFinish }: TaskCardProps) {
  const [note, setNote] = useState('')
  const [writing, setWriting] = useState(false)
  const who = task.agent.split('·')[0]?.trim()
  const isAside = task.kind === 'aside'

  return (
    <article className="skill-card work-card">
      <header className="key-group-head">
        <h3>{task.title}{fresh && <em className="work-fresh">새로 왔어요</em>}</h3>
        <small>{task.project}{task.updatedAt ? ` · ${whenText(task.updatedAt)}` : ''}</small>
      </header>
      {task.summary && <p>{task.summary}</p>}
      {task.steps.length > 0 && (
        <ol className="work-steps">
          {task.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      {task.commands.length > 0 && (
        <div className="work-commands">
          {task.commands.map((command) => (
            <div key={command} className="work-command">
              <code>{command}</code>
              <button type="button" className="skill-action" onClick={() => onCopy(command, '명령을')}>명령 복사</button>
            </div>
          ))}
        </div>
      )}
      {task.success && <p className="skill-quiet">잘 되면: {task.success}</p>}
      {isAside && <p className="work-say"><b>{task.sayToAside}</b></p>}

      <div className="skill-toolbar">
        {isAside && (
          <button type="button" className="skill-action primary" disabled={!task.prompt} onClick={() => onCopy(task.prompt, 'Aside에게 줄 글을')}>Aside에게 줄 글 복사</button>
        )}
        {!isAside && task.prompt && (
          <button type="button" className="skill-action" onClick={() => onCopy(task.prompt, '안내 글을')}>안내 글 복사</button>
        )}
        <button type="button" className={`skill-action ${isAside ? '' : 'primary'}`} onClick={() => setWriting((open) => !open)}>
          {isAside ? 'Aside 결과 붙여 넣기' : '끝났어요'}
        </button>
        <button type="button" className="skill-action" onClick={() => onDismiss(task)}>이 일 지우기</button>
      </div>

      {writing && (
        <div className="work-finish">
          <textarea
            className="work-note"
            rows={isAside ? 4 : 2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={isAside ? 'Aside가 준 결과를 그대로 붙여 넣어 주세요.' : '한 줄 남기고 싶으면 적어 주세요. 비워도 돼요.'}
            aria-label="결과"
          />
          <div className="skill-toolbar">
            <button type="button" className="skill-action primary" disabled={isAside && !note.trim()} onClick={() => onFinish(task, note)}>
              끝난 일로 옮기기
            </button>
            <button type="button" className="skill-action" onClick={() => setWriting(false)}>닫기</button>
          </div>
          <p className="skill-quiet">
            {who ? `${who}에게도 이 결과가 전해져요.` : '시킨 에이전트에게도 이 결과가 전해져요.'}
          </p>
        </div>
      )}

      <details className="skill-raw">
        <summary>원문 보기</summary>
        <code>{task.fileName}</code>
        {task.agent && <p>결과를 받을 에이전트: {task.agent}</p>}
      </details>
    </article>
  )
}

function PastList({ title, items }: { title: string; items: PastTask[] }) {
  if (!items.length) return null
  return (
    <section>
      <h3 className="work-head">{title}</h3>
      <ul className="project-skill-list">
        {items.map((item) => (
          <li key={`${item.status}-${item.project}-${item.title}`} className="work-past">
            <div className="work-past-head">
              <b>{item.project}</b>
              <span>{item.title}</span>
              {item.updatedAt > 0 && <span className="skill-quiet">{whenText(item.updatedAt)}</span>}
            </div>
            {item.note && <p className="skill-quiet">{item.note}</p>}
            {item.fullNote && item.fullNote.trim() !== item.note && (
              <details className="skill-raw"><summary>결과 전체 보기</summary><pre className="work-past-full">{item.fullNote}</pre></details>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
