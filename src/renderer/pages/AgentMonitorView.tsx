import { useEffect, useRef, useState } from 'react'
import { count, dollars, tokens, type UsageCard, type UsageScreen } from '../../core/agent-monitor/usage-summary'
import { WeekBars } from '../components/WeekBars'
import { whenText } from './skill-board-api'

interface CapResult {
  ok: boolean
  message: string
  screen: UsageScreen | null
}

interface Progress {
  done: number
  total: number
  place: string
}

interface UsageApi {
  usageScreen: () => Promise<UsageScreen>
  usageSetCap: (cardId: string, amount: number) => Promise<CapResult>
  usageOpenLink: (url: string) => Promise<{ ok: boolean; message: string }>
  onUsageProgress: (callback: (payload: Progress) => void) => () => void
}

function usageApi(): UsageApi | null {
  const api = (window as unknown as { electronAPI?: Partial<UsageApi> }).electronAPI
  return api?.usageScreen ? (api as UsageApi) : null
}

const TONE_CLASS: Record<UsageCard['tone'], string> = { ok: 'is-ok', watch: 'is-watch', over: 'is-over' }
const TONE_WORD: Record<UsageCard['tone'], string> = { ok: '', watch: '정해 둔 금액에 가까워요', over: '정해 둔 금액을 넘었어요' }
const KIND_WORD: Record<UsageCard['kind'], string> = { subscription: '구독', api: 'API 키', count: '횟수만', link: '사이트에서 확인' }
const CAP_PRESETS = [20, 50, 100, 200]
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** "9/28 (월)" for a YYYY-MM-DD day. */
function dayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(year, month - 1, date).getDay()]
  return `${month}/${date} (${weekday})`
}

/** What the reading screen says while the first read is going on. */
function progressLine(progress: Progress | null): string {
  if (!progress) return ''
  if (progress.total > 0) return `${progress.place} 기록 파일 ${count(progress.total)}개 중 ${count(progress.done)}개 읽었어요.`
  return `${progress.place} 컴퓨터 기록도 같이 읽고 있어요.`
}

/**
 * How much the AI tools cost this month, read from the agents' own logs when this screen opens.
 * Nothing runs in the background; the Founder sees numbers, not files.
 */
export function AgentMonitorView() {
  const [screen, setScreen] = useState<UsageScreen | null>(null)
  const [failed, setFailed] = useState('')
  const [notice, setNotice] = useState('')
  const [reading, setReading] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [slow, setSlow] = useState(false)
  const [othersOpen, setOthersOpen] = useState(false)
  const alive = useRef(true)

  async function load() {
    const api = usageApi()
    if (!api) {
      setFailed('이 화면은 DIOS 앱 안에서만 볼 수 있어요.')
      return
    }
    setReading(true)
    setFailed('')
    setProgress(null)
    const slowTimer = setTimeout(() => setSlow(true), 3000)
    try {
      const next = await api.usageScreen()
      if (alive.current) setScreen(next)
    } catch {
      if (alive.current) setFailed('사용 기록을 읽지 못했어요. 잠시 뒤에 다시 열어 보세요.')
    } finally {
      clearTimeout(slowTimer)
      if (alive.current) {
        setSlow(false)
        setReading(false)
        setProgress(null)
      }
    }
  }

  useEffect(() => {
    alive.current = true
    const api = usageApi()
    const stop = api?.onUsageProgress((payload) => setProgress(payload))
    void load()
    return () => {
      alive.current = false
      stop?.()
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  async function setCap(card: UsageCard, amount: number) {
    const api = usageApi()
    if (!api) return
    const result = await api.usageSetCap(card.id, amount)
    setNotice(result.message)
    if (result.screen) setScreen(result.screen)
  }

  async function openLink(url: string) {
    const api = usageApi()
    if (!api) return
    const result = await api.usageOpenLink(url)
    if (!result.ok) setNotice(result.message)
  }

  if (screen === null && !failed) {
    return (
      <section className="skill-board" aria-busy="true" aria-live="polite">
        <p className="skill-lead">이 컴퓨터의 사용 기록을 읽고 있어요.</p>
        {progress && <p className="skill-quiet">{progressLine(progress)}</p>}
        {progress && progress.total > 0 && (
          <div className="usage-meter" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
        )}
        {slow && !progress && <p className="skill-quiet">처음 한 번은 기록이 많아서 조금 걸려요. 다음부터는 바로 열려요.</p>}
        {slow && progress && <p className="skill-quiet">처음 한 번만 이래요. 다음부터는 바뀐 파일만 읽어서 바로 열려요.</p>}
        <div className="usage-cards" aria-hidden="true">
          {[0, 1].map((index) => <div key={index} className="skill-card usage-card usage-skeleton" />)}
        </div>
      </section>
    )
  }

  if (!screen) {
    return (
      <section className="skill-board">
        <p className="skill-lead">{failed}</p>
        <div className="skill-toolbar"><button type="button" className="skill-action" onClick={() => void load()}>다시 읽기</button></div>
      </section>
    )
  }

  const offPlaces = screen.places.filter((place) => !place.ok)
  const hasCaps = screen.cards.some((card) => card.cap > 0)

  return (
    <section className="skill-board" aria-label="AI 사용량">
      <header className="skill-top">
        <div>
          <p className="skill-lead">{screen.headline}</p>
          <p className="skill-quiet">{screen.trend ? `${screen.trend} ` : ''}{screen.quiet}</p>
        </div>
        <div className="skill-toolbar">
          <button type="button" className="skill-action" onClick={() => void load()} disabled={reading}>{reading ? '읽는 중…' : '지금 다시 읽기'}</button>
        </div>
      </header>

      <p className="skill-toast ok" role="status" aria-live="polite" hidden={!notice}>{notice}</p>
      {reading && progress && <p className="skill-quiet" aria-live="polite">{progressLine(progress)}</p>}
      {offPlaces.length > 0 && (
        <p className="skill-toast bad" role="status">
          {offPlaces.map((place) => place.name).join(', ')} 컴퓨터의 기록은 이번에 못 읽었어요. 꺼져 있으면 그래요. 이 컴퓨터 숫자만 보여요.
        </p>
      )}

      <div className="usage-cards">
        {screen.cards.map((card) => (
          <UsageCardView key={card.id} card={card} onCap={setCap} onLink={openLink} />
        ))}
      </div>

      {!hasCaps && screen.cards.some((card) => card.kind === 'subscription' || card.kind === 'api') && (
        <p className="skill-quiet">카드마다 "이 금액 넘으면 알려 줘"를 정해 두면 왼쪽 메뉴에 숫자가 붙어서 안 열어 봐도 알 수 있어요.</p>
      )}

      {(screen.weekProjects?.length ?? 0) > 0 && (
        <section className="skill-card work-card" aria-label="이번 주 프로젝트별">
          <header className="key-group-head">
            <h3>이번 주 프로젝트별</h3>
            <small>막대 높이는 모든 프로젝트가 같은 기준이에요</small>
          </header>
          <div className="week-projects">
            {screen.weekProjects.map((row) => (
              <div key={row.name} className="week-project">
                <h4>{row.name}</h4>
                <WeekBars graph={row.graph} peak={Math.max(...screen.weekProjects.map((item) => item.graph.peak))} compact />
                <p className="week-sentence">{row.graph.sentence.replace(/^이번 주 .*?에서 /, '')}</p>
              </div>
            ))}
          </div>
          <ul className="week-legend">
            <li><i className="week-dot is-claude_code" />Claude Code</li>
            <li><i className="week-dot is-codex" />Codex</li>
            <li><i className="week-dot is-cursor" />Cursor 대화 수</li>
          </ul>
        </section>
      )}

      {(screen.projects.length > 0 || screen.otherProjects.length > 0) && (
        <section className="skill-card work-card" aria-label="프로젝트별">
          <header className="key-group-head">
            <h3>이번 달 프로젝트별</h3>
            <small>API 기준 추정 금액</small>
          </header>
          <ul className="usage-projects">
            {screen.projects.map((project) => (
              <li key={project.name}>
                <span className="usage-project-name">{project.name}</span>
                <span className="usage-project-tools">{project.tools.join(' · ')}</span>
                <b>{dollars(project.month)}</b>
              </li>
            ))}
            {screen.otherProjects.length > 0 && (
              <li>
                <button type="button" className="skill-link usage-project-name" aria-expanded={othersOpen} onClick={() => setOthersOpen((open) => !open)}>
                  그 밖의 폴더 {screen.otherProjects.length}곳 {othersOpen ? '접기' : '보기'}
                </button>
                <span className="usage-project-tools" />
                <b>{dollars(screen.otherProjects.reduce((sum, project) => sum + project.month, 0))}</b>
              </li>
            )}
            {othersOpen && screen.otherProjects.map((project) => (
              <li key={project.name} className="usage-project-other">
                <span className="usage-project-name">{project.name}</span>
                <span className="usage-project-tools">{project.tools.join(' · ')}</span>
                <b>{dollars(project.month)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="skill-raw">
        <summary>원문 보기</summary>
        <p>읽은 컴퓨터: {screen.places.map((place) => `${place.name}${place.ok ? '' : ' (못 읽음)'}`).join(', ') || '없음'}</p>
        <p>마지막으로 읽은 때: {whenText(screen.builtAt)}</p>
        <p>금액은 각 회사의 공개 API 가격표로 계산한 추정치예요. 구독으로 쓰면 실제 청구와 달라요. Cursor는 쓴 횟수만 남겨서 금액이 없어요.</p>
        {screen.places.filter((place) => place.problem).map((place) => <p key={place.name}>{place.name}: {place.problem}</p>)}
      </details>
    </section>
  )
}

interface CardProps {
  card: UsageCard
  onCap: (card: UsageCard, amount: number) => void
  onLink: (url: string) => void
}

function UsageCardView({ card, onCap, onLink }: CardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(card.cap ? String(card.cap) : '')
  const max = Math.max(...card.bars.map((bar) => bar.value), 0.0001)
  const counting = card.kind === 'count'
  const show = (value: number) => (counting ? `${count(value)}번` : dollars(value))
  const canCap = card.kind === 'subscription' || card.kind === 'api'
  const capShare = card.cap > 0 ? Math.min(100, Math.round((card.month / card.cap) * 100)) : 0
  const first = card.bars[0]
  const last = card.bars[card.bars.length - 1]

  useEffect(() => {
    setDraft(card.cap ? String(card.cap) : '')
  }, [card.cap])

  function save(amount = Number(draft.replace(/[^\d.]/g, ''))) {
    onCap(card, Number.isFinite(amount) ? amount : 0)
    setEditing(false)
  }

  return (
    <article className={`skill-card work-card usage-card ${TONE_CLASS[card.tone]}`} aria-label={`${card.title} 사용량`}>
      <header className="key-group-head">
        <h3>{card.title}</h3>
        <small>{KIND_WORD[card.kind]}</small>
      </header>

      {card.kind !== 'link' && (
        <div className="usage-numbers">
          <div><span>오늘</span><b>{show(card.today)}</b></div>
          <div><span>이번 주</span><b>{show(card.week)}</b></div>
          <div className="usage-month"><span>이번 달</span><b>{show(card.month)}</b>{card.cap > 0 && <small> / {dollars(card.cap)}</small>}</div>
        </div>
      )}

      {card.cap > 0 && canCap && (
        <div className="usage-meter" role="img" aria-label={`정해 둔 금액의 ${capShare}%`}>
          <i style={{ width: `${capShare}%` }} />
        </div>
      )}
      {TONE_WORD[card.tone] && <p className="usage-tone">{TONE_WORD[card.tone]}</p>}

      {card.bars.length > 0 && (
        <figure className="usage-chart">
          <div className="usage-bars" role="img" aria-label={`최근 14일, 하루 최고 ${show(max)}`}>
            {card.bars.map((bar) => (
              <i key={bar.day} title={`${dayLabel(bar.day)} ${show(bar.value)}`} className={bar.value === 0 ? 'is-empty' : ''} style={{ height: `${Math.max(4, (bar.value / max) * 100)}%` }} />
            ))}
          </div>
          <figcaption className="usage-axis"><span>{first ? dayLabel(first.day) : ''}</span><span>최근 14일</span><span>{last ? dayLabel(last.day) : ''}</span></figcaption>
        </figure>
      )}

      {card.lines.map((line) => <p key={line} className="skill-quiet">{line}</p>)}
      {card.monthTokens > 0 && (
        <p className="skill-quiet">
          이번 달 {tokens(card.monthTokens)}
          {card.byPlace.length > 1 ? ` · ${card.byPlace.map((row) => `${row.place} ${show(row.month)}`).join(' · ')}` : ''}
        </p>
      )}
      {counting && card.byPlace.length > 1 && (
        <p className="skill-quiet">{card.byPlace.map((row) => `${row.place} ${show(row.month)}`).join(' · ')}</p>
      )}

      <div className="skill-toolbar">
        {card.link && <button type="button" className="skill-action" onClick={() => onLink(card.link)}>사이트에서 확인</button>}
        {canCap && !editing && (
          <button type="button" className="skill-link" onClick={() => setEditing(true)}>{card.cap > 0 ? '알려 줄 금액 바꾸기' : '이 금액 넘으면 알려 줘'}</button>
        )}
        {editing && (
          <div className="usage-cap-form" role="group" aria-label="알려 줄 금액">
            <div className="usage-cap-row">
              <input
                className="usage-cap"
                inputMode="decimal"
                aria-label="알려 줄 금액 (달러)"
                placeholder="예: 50"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') save()
                  if (event.key === 'Escape') setEditing(false)
                }}
              />
              <span className="skill-quiet">달러</span>
              <button type="button" className="skill-action" onClick={() => save()}>저장</button>
              <button type="button" className="skill-link" onClick={() => setEditing(false)}>취소</button>
            </div>
            <div className="usage-cap-row">
              {CAP_PRESETS.map((preset) => (
                <button key={preset} type="button" className="usage-preset" onClick={() => save(preset)}>{preset}달러</button>
              ))}
              {card.cap > 0 && <button type="button" className="skill-link" onClick={() => save(0)}>안 알려도 돼요</button>}
            </div>
          </div>
        )}
      </div>

      {(card.models.length > 0 || card.lastUsed) && (
        <details className="skill-raw">
          <summary>원문 보기</summary>
          {card.models.length > 0 && <p>많이 쓴 모델: {card.models.join(', ')}</p>}
          {card.lastUsed && <p>마지막으로 쓴 날: {dayLabel(card.lastUsed)}</p>}
          {card.projected > 0 && <p>월말 예상: 이번 달 하루 평균으로 계산한 값이에요.</p>}
        </details>
      )}
    </article>
  )
}
