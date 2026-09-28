import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibrarySkill } from '../../core/skill-library/catalog'
import type { FetchOutcome, SkillCandidate } from '../../core/skill-library/fetch-skill'
import type { LibraryListing, LibraryResult, RemoteSkill } from '../../core/skill-library/library-service'
import { whenText } from './skill-board-api'
import { OPEN_KEY } from './SkillBoardView'

interface LibraryApi {
  libraryList: () => Promise<LibraryListing>
  libraryPreview: (address: string) => Promise<FetchOutcome>
  libraryAdd: (candidate: SkillCandidate, agentIds: string[] | null) => Promise<LibraryResult>
  libraryAddFolder: (agentIds: string[] | null) => Promise<LibraryResult & { listing: LibraryListing | null }>
  libraryAttach: (name: string, agentIds: string[]) => Promise<LibraryResult>
  libraryAdopt: (name: string, from: string, agentIds: string[] | null) => Promise<LibraryResult>
  libraryRemotes: () => Promise<{ ok: boolean; message: string; skills: RemoteSkill[] }>
  libraryTake: (placeId: string, name: string) => Promise<LibraryResult>
  libraryGather: () => Promise<LibraryResult>
  libraryBlurb: (name: string) => Promise<{ ok: boolean; message: string; korean: string }>
  libraryOpenFolder: (folder: string) => Promise<{ ok: boolean; message: string }>
}

type Filter = 'all' | 'new' | 'shared' | 'loose' | `agent:${string}`
type AddMode = 'none' | 'address' | 'remote'
type Notice = { ok: boolean; text: string } | null

interface SkillViewProps {
  onNavigate?: (view: string) => void
}

function libraryApi(): LibraryApi | null {
  const api = (window as unknown as { electronAPI?: Partial<LibraryApi> }).electronAPI
  return api?.libraryList ? (api as LibraryApi) : null
}

/** "Claude, Codex에 붙어 있어요" style. */
function homesLine(skill: LibrarySkill): string {
  const agents = skill.homes.filter((home) => home.id !== 'cursor-builtin' && home.id !== 'hermes' && home.id !== 'folder').map((home) => home.name)
  const others = skill.homes.filter((home) => home.id === 'cursor-builtin' || home.id === 'hermes' || home.id === 'folder').map((home) => home.name)
  const parts: string[] = []
  if (agents.length) parts.push(`${agents.join(', ')}에 붙어 있어요`)
  if (others.length) parts.push(`${[...new Set(others)].join(', ')} 폴더에 있어요`)
  if (!parts.length) parts.push(skill.canonical ? '공용 폴더에만 있어요. 아직 아무 에이전트에도 안 붙었어요' : '어디에도 안 붙어 있어요')
  return parts.join(' · ')
}

/** Who and when, for the small line under the title. */
function originLine(skill: LibrarySkill): string {
  const when = skill.createdAt ? whenText(skill.createdAt) : ''
  if (skill.author && when) return `${skill.author} · ${when}에 생김`
  if (skill.author) return skill.author
  if (when) return `${when}에 생김 · 만든 이 기록 없음`
  return '만든 이 기록 없음'
}

/**
 * Every skill on this computer in one place, with where it lives and who made it.
 * New skills come from an address, a folder, or another computer, and land on the agents right away.
 */
export function SkillView({ onNavigate }: SkillViewProps) {
  const [listing, setListing] = useState<LibraryListing | null>(null)
  const [failed, setFailed] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [addMode, setAddMode] = useState<AddMode>('none')
  const [address, setAddress] = useState('')
  const [preview, setPreview] = useState<FetchOutcome | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [remotes, setRemotes] = useState<{ ok: boolean; message: string; skills: RemoteSkill[] } | null>(null)
  const [attachFor, setAttachFor] = useState('')
  const [pickedAgents, setPickedAgents] = useState<string[]>([])
  const [koreanProgress, setKoreanProgress] = useState<{ done: number; total: number } | null>(null)
  const stopKorean = useRef(false)

  async function load() {
    const api = libraryApi()
    if (!api) {
      setFailed('이 화면은 DIOS 앱 안에서만 볼 수 있어요.')
      return
    }
    try {
      setListing(await api.libraryList())
      setFailed('')
    } catch {
      setFailed('스킬 목록을 읽지 못했어요. 잠시 뒤에 다시 열어 보세요.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 7000)
    return () => clearTimeout(timer)
  }, [notice])

  function apply(result: LibraryResult | (LibraryResult & { listing: LibraryListing | null })) {
    if (result.message) setNotice({ ok: result.ok, text: result.message })
    if (result.listing) setListing(result.listing)
  }

  async function lookUp() {
    const api = libraryApi()
    if (!api || !address.trim()) return
    setPreviewing(true)
    setPreview(null)
    try {
      setPreview(await api.libraryPreview(address))
    } catch {
      setPreview({ ok: false, message: '주소를 확인하지 못했어요. 인터넷 연결을 봐 주세요.', candidates: [] })
    } finally {
      setPreviewing(false)
    }
  }

  async function take(candidate: SkillCandidate) {
    const api = libraryApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.libraryAdd(candidate, null)
      apply(result)
      if (result.ok) {
        setPreview((current) => current ? { ...current, candidates: current.candidates.filter((item) => item.name !== candidate.name) } : current)
        if (preview && preview.candidates.length <= 1) {
          setAddMode('none')
          setAddress('')
          setPreview(null)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  async function makeKorean() {
    const api = libraryApi()
    if (!api || !listing) return
    const todo = listing.skills.filter((skill) => !skill.korean)
    if (!todo.length) return
    stopKorean.current = false
    setKoreanProgress({ done: 0, total: todo.length })
    setBusy(true)
    let failed = 0
    try {
      for (let index = 0; index < todo.length; index += 1) {
        if (stopKorean.current) break
        const skill = todo[index]
        try {
          const result = await api.libraryBlurb(skill.name)
          if (result.korean) {
            setListing((current) => current ? { ...current, skills: current.skills.map((item) => item.name === skill.name ? { ...item, korean: result.korean } : item) } : current)
          } else {
            failed += 1
          }
        } catch {
          failed += 1
        }
        setKoreanProgress({ done: index + 1, total: todo.length })
      }
    } finally {
      setBusy(false)
      setKoreanProgress(null)
      if (failed) setNotice({ ok: false, text: `${failed}개는 한 문장으로 만들지 못해서 영어 그대로 뒀어요. 다시 누르면 그 것만 또 시도해요.` })
      else if (!stopKorean.current) setNotice({ ok: true, text: '한글 설명을 만들었어요.' })
    }
  }

  async function gather() {
    const api = libraryApi()
    if (!api) return
    setBusy(true)
    try {
      apply(await api.libraryGather())
    } finally {
      setBusy(false)
    }
  }

  async function pickFolder() {
    const api = libraryApi()
    if (!api) return
    setBusy(true)
    try {
      apply(await api.libraryAddFolder(null))
    } finally {
      setBusy(false)
    }
  }

  async function openRemotes() {
    const api = libraryApi()
    if (!api) return
    setAddMode('remote')
    setRemotes(null)
    try {
      setRemotes(await api.libraryRemotes())
    } catch {
      setRemotes({ ok: false, message: '다른 컴퓨터를 읽지 못했어요.', skills: [] })
    }
  }

  async function takeRemote(skill: RemoteSkill) {
    const api = libraryApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.libraryTake(skill.placeId, skill.name)
      apply(result)
      if (result.ok) setRemotes((current) => current ? { ...current, skills: current.skills.filter((item) => item.name !== skill.name) } : current)
    } finally {
      setBusy(false)
    }
  }

  async function attach(skill: LibrarySkill) {
    const api = libraryApi()
    if (!api || !pickedAgents.length) return
    setBusy(true)
    try {
      apply(await api.libraryAttach(skill.name, pickedAgents))
      setAttachFor('')
    } finally {
      setBusy(false)
    }
  }

  async function adopt(skill: LibrarySkill) {
    const api = libraryApi()
    const from = skill.homes.find((home) => !home.link)
    if (!api || !from) return
    setBusy(true)
    try {
      apply(await api.libraryAdopt(skill.name, from.path, null))
    } finally {
      setBusy(false)
    }
  }

  function openOnBoard(skill: LibrarySkill) {
    try {
      window.localStorage.setItem(OPEN_KEY, skill.name)
    } catch {
      // Without storage the board opens on its list instead.
    }
    onNavigate?.('skillBoard')
  }

  const skills = listing?.skills ?? []
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return skills.filter((skill) => {
      if (needle && !`${skill.name} ${skill.summary} ${skill.author}`.toLowerCase().includes(needle)) return false
      if (filter === 'new') return skill.isNew
      if (filter === 'shared') return skill.canonical
      if (filter === 'loose') return !skill.canonical
      if (filter.startsWith('agent:')) return skill.agents.includes(filter.slice(6))
      return true
    })
  }, [skills, search, filter])

  const newCount = skills.filter((skill) => skill.isNew).length
  const looseCount = skills.filter((skill) => !skill.canonical).length
  const gatherCount = skills.filter((skill) => !skill.canonical && skill.homes.some((home) => home.id !== 'cursor-builtin' && !home.link)).length

  if (listing === null && !failed) {
    return <section className="skill-board"><p className="skill-lead">이 컴퓨터의 스킬을 모으고 있어요.</p></section>
  }
  if (!listing) {
    return (
      <section className="skill-board">
        <p className="skill-lead">{failed}</p>
        <div className="skill-toolbar"><button type="button" className="skill-action" onClick={() => void load()}>다시 읽기</button></div>
      </section>
    )
  }

  return (
    <section className="skill-board" aria-label="스킬 라이브러리">
      <header className="skill-top">
        <div>
          <p className="skill-lead">
            {skills.length ? `이 컴퓨터에 스킬 ${skills.length}개가 있어요.${newCount ? ` 이번 주에 ${newCount}개가 새로 생겼어요.` : ''}` : '아직 스킬이 없어요. 아래에서 첫 스킬을 받아 보세요.'}
          </p>
          <p className="skill-quiet">Claude, Codex, Cursor 같은 에이전트 폴더와 공용 폴더를 모두 모아 보여 줘요. 받은 스킬은 준비된 에이전트에 바로 붙어요.</p>
        </div>
        <div className="skill-toolbar">
          <button type="button" className="skill-action is-primary" onClick={() => setAddMode(addMode === 'address' ? 'none' : 'address')} aria-expanded={addMode === 'address'}>주소로 받기</button>
          <button type="button" className="skill-action" onClick={() => void pickFolder()} disabled={busy}>폴더에서 추가</button>
          {gatherCount > 0 && <button type="button" className="skill-action is-primary" onClick={() => void gather()} disabled={busy}>한 곳에만 있는 {gatherCount}개 모으기</button>}
          {skills.some((skill) => !skill.korean) && !koreanProgress && <button type="button" className="skill-action" onClick={() => void makeKorean()} disabled={busy}>한글 설명 만들기</button>}
          {koreanProgress && <button type="button" className="skill-action" onClick={() => { stopKorean.current = true }}>한글 설명 멈추기 · {koreanProgress.done}/{koreanProgress.total}</button>}
          <button type="button" className="skill-action" onClick={() => void openRemotes()} aria-expanded={addMode === 'remote'}>다른 컴퓨터에서</button>
          <button type="button" className="skill-action" onClick={() => void load()} disabled={busy}>다시 읽기</button>
        </div>
      </header>

      {notice && <p className={`skill-toast ${notice.ok ? 'ok' : 'bad'}`} role="status" aria-live="polite">{notice.text}</p>}

      {addMode === 'address' && (
        <section className="skill-card work-card" aria-label="주소로 받기">
          <h3>주소로 받기</h3>
          <p className="skill-quiet">GitHub 주소나 SKILL.md 파일 주소를 붙여 넣으면 이 컴퓨터에 받아서 에이전트에 붙여요. 저장소 하나에 스킬이 여럿이면 골라서 받아요.</p>
          <div className="library-address">
            <input
              className="library-input"
              placeholder="예: github.com/이름/저장소 또는 이름/저장소"
              value={address}
              aria-label="스킬 주소"
              autoFocus
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void lookUp() }}
            />
            <button type="button" className="skill-action is-primary" onClick={() => void lookUp()} disabled={previewing || !address.trim()}>{previewing ? '찾는 중…' : '찾기'}</button>
            <button type="button" className="skill-link" onClick={() => { setAddMode('none'); setPreview(null) }}>닫기</button>
          </div>
          {preview && !preview.ok && <p className="skill-toast bad" role="alert">{preview.message}</p>}
          {preview?.ok && (
            <div className="library-candidates">
              {preview.message && <p className="skill-quiet">{preview.message}</p>}
              {preview.candidates.map((candidate) => {
                const exists = skills.some((skill) => skill.name === candidate.name)
                return (
                  <div key={candidate.name} className="library-candidate">
                    <div>
                      <b>{candidate.name}</b>
                      <p className="skill-quiet">{candidate.summary || '설명이 없어요.'} · 파일 {candidate.files.length}개</p>
                      {exists && <p className="usage-tone">같은 이름의 스킬이 이미 있어요.</p>}
                    </div>
                    <button type="button" className="skill-action is-primary" onClick={() => void take(candidate)} disabled={busy || exists}>다운로드하기</button>
                  </div>
                )
              })}
              {!preview.candidates.length && <p className="skill-quiet">모두 받았어요.</p>}
            </div>
          )}
        </section>
      )}

      {addMode === 'remote' && (
        <section className="skill-card work-card" aria-label="다른 컴퓨터에서">
          <header className="key-group-head">
            <h3>다른 컴퓨터에 있고 여기엔 없는 스킬</h3>
            <button type="button" className="skill-link" onClick={() => setAddMode('none')}>닫기</button>
          </header>
          {!remotes && <p className="skill-quiet">다른 컴퓨터를 읽고 있어요. 꺼져 있으면 조금 걸려요.</p>}
          {remotes?.message && <p className="skill-quiet">{remotes.message}</p>}
          {remotes && !remotes.skills.length && <p className="skill-quiet">가져올 스킬이 없어요. 다른 컴퓨터의 스킬이 모두 여기에도 있어요.</p>}
          {remotes && remotes.skills.length > 0 && (
            <div className="library-candidates">
              {remotes.skills.map((skill) => (
                <div key={`${skill.placeId}/${skill.name}`} className="library-candidate">
                  <div>
                    <b>{skill.name}</b> <small className="skill-quiet">{skill.placeName}</small>
                    <p className="skill-quiet">{skill.summary || '설명이 없어요.'}</p>
                  </div>
                  <button type="button" className="skill-action is-primary" onClick={() => void takeRemote(skill)} disabled={busy}>가져오기</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="library-filters" role="toolbar" aria-label="스킬 고르기">
        <input className="library-input library-search" placeholder="이름이나 설명으로 찾기" value={search} aria-label="스킬 찾기" onChange={(event) => setSearch(event.target.value)} />
        <div className="library-chips">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>전체 {skills.length}</Chip>
          {newCount > 0 && <Chip active={filter === 'new'} onClick={() => setFilter('new')}>새로 생김 {newCount}</Chip>}
          <Chip active={filter === 'shared'} onClick={() => setFilter('shared')}>공용 폴더 {skills.length - looseCount}</Chip>
          {looseCount > 0 && <Chip active={filter === 'loose'} onClick={() => setFilter('loose')}>한 곳에만 {looseCount}</Chip>}
          {listing.readyAgents.map((agent) => (
            <Chip key={agent.id} active={filter === `agent:${agent.id}`} onClick={() => setFilter(`agent:${agent.id}`)}>{agent.name} {skills.filter((skill) => skill.agents.includes(agent.id)).length}</Chip>
          ))}
        </div>
      </div>

      {!shown.length && <p className="skill-quiet">{search ? '그 말이 들어간 스킬이 없어요.' : '여기에 해당하는 스킬이 없어요.'}</p>}

      <div className="library-grid">
        {shown.map((skill) => (
          <article key={skill.name} className={`skill-card work-card library-card ${skill.isNew ? 'is-new' : ''}`} aria-label={`${skill.name} 스킬`}>
            <header className="key-group-head">
              <h3>{skill.name}{skill.isNew && <em className="work-fresh">새로 생김</em>}</h3>
              <small>{skill.canonical ? '공용' : '한 곳에만'}</small>
            </header>
            <p className="library-summary">{skill.korean || skill.summary || '설명이 없어요.'}</p>
            <p className="skill-quiet">{originLine(skill)}</p>
            <p className="skill-quiet">{homesLine(skill)}</p>
            {skill.homes.some((home) => home.different) && <p className="usage-tone">어느 폴더의 글이 공용 폴더와 달라요. 스킬 보드에서 맞출 수 있어요.</p>}

            <div className="skill-toolbar">
              {skill.canonical && attachFor !== skill.name && (
                <button type="button" className="skill-action" onClick={() => { setAttachFor(skill.name); setPickedAgents(listing.readyAgents.map((agent) => agent.id).filter((id) => !skill.agents.includes(id))) }}>
                  에이전트에 붙이기
                </button>
              )}
              {!skill.canonical && (
                <button type="button" className="skill-action is-primary" onClick={() => void adopt(skill)} disabled={busy}>공용 폴더에 넣고 붙이기</button>
              )}
              {skill.canonical && <button type="button" className="skill-link" onClick={() => openOnBoard(skill)}>스킬 보드에서 보기</button>}
            </div>

            {attachFor === skill.name && (
              <div className="library-attach" role="group" aria-label="붙일 에이전트">
                {listing.readyAgents.map((agent) => (
                  <label key={agent.id} className="library-check">
                    <input
                      type="checkbox"
                      checked={pickedAgents.includes(agent.id)}
                      disabled={skill.agents.includes(agent.id)}
                      onChange={() => setPickedAgents((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])}
                    />
                    {agent.name}{skill.agents.includes(agent.id) ? ' (이미 붙음)' : ''}
                  </label>
                ))}
                <div className="skill-toolbar">
                  <button type="button" className="skill-action is-primary" onClick={() => void attach(skill)} disabled={busy || !pickedAgents.length}>붙이기</button>
                  <button type="button" className="skill-link" onClick={() => setAttachFor('')}>취소</button>
                </div>
              </div>
            )}

            <details className="skill-raw">
              <summary>원문 보기</summary>
              <p>파일 {skill.fileCount}개 · 마지막 수정 {skill.updatedAt ? whenText(skill.updatedAt) : '모름'}</p>
              {skill.korean && skill.summary && <p>{skill.summary}</p>}
              {skill.source && <p>출처: {skill.source}</p>}
              {skill.homes.map((home) => (
                <p key={home.path}>
                  {home.name}: {home.path} {home.link ? '(공용 폴더를 가리킴)' : ''}
                  {' '}<button type="button" className="skill-link" onClick={() => void libraryApi()?.libraryOpenFolder(home.path)}>폴더 열기</button>
                </p>
              ))}
            </details>
          </article>
        ))}
      </div>
    </section>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`library-chip ${active ? 'is-active' : ''}`} aria-pressed={active} onClick={onClick}>{children}</button>
  )
}
