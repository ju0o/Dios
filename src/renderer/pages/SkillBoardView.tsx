import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { MarkdownViewer } from '../components/MarkdownViewer'
import type { BoardAgent, BoardSkill } from '../../core/skill-board/model'
import type { Place } from '../../core/skill-board/places'
import { boardApi, matchesSearch, type BoardResult, type SkillBoard } from './skill-board-api'
import { splitSkillText } from '../../core/skill-board/markdown-text'
import { ComparePanel, HistoryPanel, IntroGuide, TrashPanel } from './SkillBoardPanels'

type Notice = { ok: boolean; text: string } | null
type Panel = 'none' | 'trash' | 'compare'
type BoardView = 'skills' | 'agents'
type ReadMode = 'read' | 'korean' | 'edit' | 'history'

const INTRO_KEY = 'dios.skillBoard.introDone'

function introDone(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Founder screen for attaching skills to agents, on this computer, a WSL distro, or an SSH host.
 * Hover lights that skill's flow. Click opens the detail. Drag attaches or removes a link.
 */
export function SkillBoardView() {
  const [placeList, setPlaceList] = useState<Place[]>([])
  const [placeId, setPlaceId] = useState('local')
  const [board, setBoard] = useState<SkillBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<BoardView>('skills')
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSummary, setNewSummary] = useState('')
  const [newSteps, setNewSteps] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [original, setOriginal] = useState('')
  const [sendTo, setSendTo] = useState('')
  const [replaceAsk, setReplaceAsk] = useState(false)
  const [pickedAgents, setPickedAgents] = useState<string[]>([])
  const [reflectAsk, setReflectAsk] = useState(false)
  const [reflectIds, setReflectIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [showIntro, setShowIntro] = useState(() => !introDone())
  const [panel, setPanel] = useState<Panel>('none')
  const [trashAsk, setTrashAsk] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [guideAsk, setGuideAsk] = useState<'on' | 'off' | null>(null)
  const [readText, setReadText] = useState('')
  const [showKorean, setShowKorean] = useState(false)
  const [koreanText, setKoreanText] = useState('')
  const [savedKorean, setSavedKorean] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const translateSeq = useRef(0)
  const [descOpen, setDescOpen] = useState(false)

  useEffect(() => {
    setEditing(false)
    setTrashAsk(false)
    setHistoryOpen(false)
    setReflectAsk(false)
    setReplaceAsk(false)
    setShowKorean(false)
    setKoreanText('')
    setSavedKorean(false)
    setDescOpen(false)
    setTranslating(false)
    setTranslateError('')
    translateSeq.current += 1
  }, [pinnedId, placeId])

  useEffect(() => {
    if (!pinnedId) {
      setReadText('')
      return
    }
    const api = boardApi()
    if (!api) return
    let cancel = false
    api.skillBoardRead(placeId, pinnedId).then((result) => {
      if (!cancel && result.ok) setReadText(result.text)
    }).catch(() => { if (!cancel) setReadText('') })
    return () => { cancel = true }
  }, [pinnedId, placeId])

  function closeIntro() {
    setShowIntro(false)
    try {
      window.localStorage.setItem(INTRO_KEY, '1')
    } catch {
      // Without storage the guide simply shows again next time.
    }
  }

  useEffect(() => {
    const api = boardApi()
    if (!api) {
      setFailed('이 화면은 Dios 앱에서 열려요.')
      setLoading(false)
      return
    }
    api.skillBoardPlaces().then(setPlaceList).catch(() => setPlaceList([{ id: 'local', name: '이 컴퓨터', kind: 'local', target: '' }]))
  }, [])

  const refresh = useCallback(async (id: string) => {
    const api = boardApi()
    if (!api) return
    setLoading(true)
    setBoard(null)
    setPinnedId(null)
    try {
      const result = await api.skillBoardGet(id)
      if (result.ok) {
        setBoard(result.board)
        setFailed('')
      } else {
        setFailed(result.problem)
      }
    } catch {
      setFailed('스킬 목록을 읽지 못했어요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh(placeId) }, [placeId, refresh])

  const pinned = board?.skills.find((skill) => skill.name === pinnedId) ?? null
  const currentPlace = placeList.find((place) => place.id === placeId)

  async function apply(result: BoardResult) {
    if (result.board.agents.length) setBoard(result.board)
    setNotice({ ok: result.ok, text: result.message })
    return result
  }

  async function registerSkill() {
    const api = boardApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await apply(await api.skillBoardCreate(placeId, newName.trim(), newSummary.trim(), newSteps.split('\n'), pickedAgents))
      if (result.ok) {
        setCreating(false)
        setNewName('')
        setNewSummary('')
        setNewSteps('')
        setPickedAgents([])
        setPinnedId(newName.trim())
      }
    } catch {
      setNotice({ ok: false, text: '지금 등록하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  function openSkill(name: string, mode: 'read' | 'edit') {
    setPinnedId(name)
    setView('skills')
    if (mode === 'edit') void openEditor(name)
    else setEditing(false)
  }

  function pickReadMode(mode: ReadMode) {
    if (!pinned) return
    setHistoryOpen(mode === 'history')
    if (mode === 'edit') {
      setShowKorean(false)
      void openEditor(pinned.name)
      return
    }
    setEditing(false)
    if (mode === 'korean') {
      setShowKorean(true)
      void showSavedTranslation(pinned.name, readText)
      return
    }
    translateSeq.current += 1
    setTranslating(false)
    setShowKorean(false)
  }

  async function showSavedTranslation(name: string, text: string) {
    if (savedKorean && koreanText) {
      setShowKorean(true)
      setTranslateError('')
      setNotice({ ok: true, text: '저장해 둔 번역본이에요.' })
      return
    }
    const api = boardApi()
    if (!api) return
    const seq = ++translateSeq.current
    setShowKorean(true)
    setTranslating(true)
    setTranslateError('')
    try {
      const result = await api.skillBoardTranslate(placeId, name, text)
      if (seq !== translateSeq.current) return
      if (!result.ok) {
        setTranslateError(result.message)
        return
      }
      setKoreanText(result.text)
      setSavedKorean(result.message.startsWith('저장해 둔') || result.message.startsWith('번역본을 저장') || result.message.startsWith('영어 글이 바뀌어서'))
      setNotice({ ok: true, text: result.message })
    } catch {
      if (seq !== translateSeq.current) return
      setTranslateError('번역하지 못했어요. 다시 번역을 눌러 주세요.')
    } finally {
      if (seq === translateSeq.current) setTranslating(false)
    }
  }

  async function openEditor(name: string) {
    const api = boardApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.skillBoardRead(placeId, name)
      if (!result.ok) {
        setNotice({ ok: false, text: result.message })
        return
      }
      setOriginal(result.text)
      setDraft(result.text)
      setEditing(true)
    } catch {
      setNotice({ ok: false, text: '글을 열지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft(name: string) {
    const api = boardApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await apply(await api.skillBoardSave(placeId, name, draft))
      if (result.ok) {
        const saved = draft.endsWith('\n') ? draft : `${draft}\n`
        setOriginal(saved)
        setReadText(saved)
        setKoreanText('')
        setSavedKorean(false)
        setShowKorean(false)
        setEditing(false)
      }
    } catch {
      setNotice({ ok: false, text: '저장하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function sendSkill(name: string, overwrite: boolean) {
    const api = boardApi()
    if (!api || !sendTo) return
    setBusy(true)
    try {
      const agents = board?.skills.find((skill) => skill.name === name)?.agents
      const result = await apply(await api.skillBoardSend(placeId, sendTo, name, overwrite, agents))
      if (result.ok) setReplaceAsk(false)
      else if (result.message === '이미 있어요.') setReplaceAsk(true)
    } catch {
      setNotice({ ok: false, text: '보내지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function lookForCopies(name: string) {
    const api = boardApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.skillBoardHolders(placeId, name)
      if (!result.ok) {
        setNotice({ ok: false, text: result.message })
        return
      }
      const different = result.places.filter((place) => place.state === 'different')
      const same = result.places.filter((place) => place.state === 'same')
      if (!different.length) {
        setReflectAsk(false)
        const quiet = same.length ? '다른 컴퓨터의 글도 이미 같아요.' : '다른 컴퓨터에는 이 스킬이 없어요.'
        setNotice({ ok: !result.message, text: result.message || quiet })
        return
      }
      setReflectIds(different.map((place) => place.id))
      setReflectAsk(true)
      setNotice({ ok: true, text: [result.message, `${different.map((place) => place.name).join(', ')}의 글이 달라요.`].filter(Boolean).join(' ') })
    } catch {
      setNotice({ ok: false, text: '다른 컴퓨터를 확인하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function reflectCopies(name: string) {
    const api = boardApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await apply(await api.skillBoardReflect(placeId, name, reflectIds))
      if (result.ok) setReflectAsk(false)
    } catch {
      setNotice({ ok: false, text: '반영하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function trashPinned(name: string) {
    const api = boardApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await apply(await api.skillBoardTrash(placeId, name))
      if (result.ok) setPinnedId(null)
      setTrashAsk(false)
    } catch {
      setNotice({ ok: false, text: '지우지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  function pickFromCompare(name: string) {
    if (board?.skills.some((skill) => skill.name === name)) {
      setPinnedId(name)
      return
    }
    setNotice({ ok: false, text: `${name}은 지금 보는 컴퓨터에 없어요. 그 스킬이 있는 컴퓨터 탭에서 열고 "다른 컴퓨터로 보내기"를 쓰세요.` })
  }

  async function ackAll() {
    const api = boardApi()
    if (!api || !board) return
    const changed = board.skills.filter((skill) => skill.changed)
    if (!changed.length) return
    setBusy(true)
    try {
      for (const skill of changed) await api.skillBoardAck(placeId, skill.name)
      await reloadQuiet()
      setNotice({ ok: true, text: `바뀐 스킬 ${changed.length}개를 확인했어요.` })
    } catch {
      setNotice({ ok: false, text: '확인하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function guideAll(on: boolean) {
    const api = boardApi()
    if (!api || !board) return
    const targets = board.agents.filter((agent) => agent.ready && agent.id !== 'agent-relay' && agent.guideOn !== on)
    setGuideAsk(null)
    if (!targets.length) {
      setNotice({ ok: true, text: on ? '이미 모두 켜져 있어요.' : '이미 모두 꺼져 있어요.' })
      return
    }
    setBusy(true)
    try {
      const notes: string[] = []
      for (const agent of targets) {
        const result = await api.skillBoardGuide(placeId, agent.id, on)
        if (!result.ok) notes.push(result.message)
      }
      await reloadQuiet()
      setNotice({ ok: notes.length === 0, text: notes[0] || (on ? `${targets.length}곳의 매 대화 안내를 켰어요.` : `${targets.length}곳의 매 대화 안내를 껐어요.`) })
    } catch {
      setNotice({ ok: false, text: '안내를 바꾸지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function reloadQuiet() {
    const api = boardApi()
    if (!api) return
    const result = await api.skillBoardGet(placeId)
    if (result.ok) setBoard(result.board)
  }

  async function toggleGuide(agentId: string, on: boolean) {
    const api = boardApi()
    if (!api) return
    setBusy(true)
    try {
      await apply(await api.skillBoardGuide(placeId, agentId, on))
    } catch {
      setNotice({ ok: false, text: '안내를 바꾸지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function run(action: 'link' | 'unlink' | 'ack', agentId: string, skillName: string) {
    const api = boardApi()
    if (!api) return
    setBusy(true)
    try {
      const result = action === 'ack'
        ? await api.skillBoardAck(placeId, skillName)
        : action === 'link'
          ? await api.skillBoardLink(placeId, agentId, skillName)
          : await api.skillBoardUnlink(placeId, agentId, skillName)
      if (result.board.agents.length) setBoard(result.board)
      setNotice({ ok: result.ok, text: result.message })
    } catch {
      setNotice({ ok: false, text: '지금 바꾸지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  const placeTabs = placeList.length > 1 && (
    <nav className="place-tabs" aria-label="컴퓨터 고르기">
      {placeList.map((place) => (
        <button key={place.id} type="button" className={place.id === placeId ? 'is-on' : ''} onClick={() => { setNotice(null); setFailed(''); setPlaceId(place.id) }}>
          {place.name}
        </button>
      ))}
    </nav>
  )

  function onDropAgent(agentId: string, event: DragEvent) {
    event.preventDefault()
    const [skillName, from] = event.dataTransfer.getData('text/plain').split('\n')
    if (!skillName || from === agentId) return
    void run('link', agentId, skillName)
  }

  function onDropShelf(event: DragEvent) {
    event.preventDefault()
    const [skillName, from] = event.dataTransfer.getData('text/plain').split('\n')
    if (!skillName || !from || from === 'shelf') return
    void run('unlink', from, skillName)
  }

  if (loading || (!board && !failed)) {
    return <section className="skill-board">{placeTabs}<p className="skill-lead">{currentPlace && currentPlace.kind !== 'local' ? `${currentPlace.name}에 연결하고 있어요.` : '스킬을 읽고 있어요.'}</p></section>
  }
  if (failed || !board) {
    return (
      <section className="skill-board">
        {placeTabs}
        <p className="skill-lead">{failed || '스킬 목록을 읽지 못했어요.'}</p>
        <p className="skill-quiet">{placeList.length > 1 ? '다른 컴퓨터 탭을 눌러도 되고, 아래 버튼으로 다시 시도해도 돼요.' : 'Dios를 데스크톱 앱으로 열면 이 컴퓨터의 스킬이 보여요.'}</p>
        {boardApi() && <button type="button" className="skill-action" onClick={() => void refresh(placeId)}>다시 시도</button>}
      </section>
    )
  }

  const changedCount = board.skills.filter((skill) => skill.changed).length
  const shownSkills = board.skills.filter((skill) => matchesSearch(skill, search))
  const readyAgents = board.agents.filter((agent) => agent.ready)
  const readMode: ReadMode = editing ? 'edit' : historyOpen ? 'history' : showKorean ? 'korean' : 'read'
  const shownText = splitSkillText(showKorean ? koreanText : readText)
  const related = pinned ? relatedSkills(board, pinned) : []
  const skillLine = (showKorean && shownText.description) || pinned?.summary || splitSkillText(readText).description
  const otherPlaces = placeList.filter((place) => place.id !== placeId)

  return (
    <section className="skill-board">
      {placeTabs}
      <header className="skill-top">
        <p className="skill-lead">
          {currentPlace && currentPlace.kind !== 'local' ? `${currentPlace.name}의 ` : ''}스킬 {board.skills.length}개, 연결된 에이전트 {readyAgents.length}곳이에요.
          {' '}스킬을 누르면 오른쪽에서 읽고, 붙이고, 고쳐요.
        </p>
        <div className="skill-toolbar">
          <button type="button" className="skill-action primary" onClick={() => setCreating((open) => !open)}>{creating ? '등록 닫기' : '새 스킬 등록'}</button>
          {placeList.length > 1 && (
            <button type="button" className="skill-action" aria-pressed={panel === 'compare'} onClick={() => setPanel((open) => open === 'compare' ? 'none' : 'compare')}>
              {panel === 'compare' ? '비교 닫기' : '컴퓨터끼리 비교'}
            </button>
          )}
          <button type="button" className="skill-action" aria-pressed={panel === 'trash'} onClick={() => setPanel((open) => open === 'trash' ? 'none' : 'trash')}>
            {panel === 'trash' ? '휴지통 닫기' : '휴지통'}
          </button>
          <details className="skill-more">
            <summary>더 보기</summary>
            <div className="skill-more-menu">
              {!showIntro && <button type="button" className="skill-action" onClick={() => setShowIntro(true)}>처음 안내 다시 보기</button>}
              {changedCount > 1 && <button type="button" className="skill-action" disabled={busy} onClick={() => void ackAll()}>바뀐 것 모두 확인</button>}
              <button type="button" className="skill-action" disabled={busy} onClick={() => setGuideAsk('on')}>매 대화 안내 모두 켜기</button>
              <button type="button" className="skill-action" disabled={busy} onClick={() => setGuideAsk('off')}>매 대화 안내 모두 끄기</button>
            </div>
          </details>
        </div>
      </header>
      {showIntro && <IntroGuide onClose={closeIntro} />}
      {guideAsk && (
        <div className="skill-change">
          <b>{guideAsk === 'on' ? '준비된 에이전트의 매 대화를 이 안내로 시작할까요?' : '준비된 에이전트의 매 대화 안내를 끌까요? 다른 글은 남아요.'}</b>
          <button type="button" className="skill-action primary" disabled={busy} onClick={() => setGuideAsk(null)}>그대로 두기</button>
          <button type="button" className="skill-action" disabled={busy} onClick={() => void guideAll(guideAsk === 'on')}>{guideAsk === 'on' ? '모두 켜기' : '모두 끄기'}</button>
        </div>
      )}
      {panel === 'compare' && boardApi() && (
        <ComparePanel api={boardApi()!} placeId={placeId} busy={busy} onPick={pickFromCompare} onChanged={(result) => { setNotice({ ok: result.ok, text: result.message }); void reloadQuiet() }} />
      )}
      {panel === 'trash' && boardApi() && <TrashPanel api={boardApi()!} placeId={placeId} busy={busy} onResult={(result) => void apply(result)} />}
      {creating && (
        <form className="skill-form skill-card" onSubmit={(event) => { event.preventDefault(); void registerSkill() }}>
          <label>이름<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="weekly-report" autoComplete="off" /></label>
          <label>하는 일<input value={newSummary} onChange={(event) => setNewSummary(event.target.value)} placeholder="한 문장으로 적어 주세요" /></label>
          <label>순서<textarea value={newSteps} onChange={(event) => setNewSteps(event.target.value)} placeholder={'한 줄에 하나씩\n브라우저 일은 Aside에게 보내요'} rows={4} /></label>
          <fieldset className="skill-picks">
            <legend>붙일 에이전트</legend>
            <button type="button" className="skill-action" onClick={() => setPickedAgents(readyAgents.map((agent) => agent.id))}>준비된 곳 모두</button>
            <button type="button" className="skill-action" onClick={() => setPickedAgents([])}>선택 해제</button>
            {readyAgents.map((agent) => (
              <label key={agent.id} className="skill-check">
                <input
                  type="checkbox"
                  checked={pickedAgents.includes(agent.id)}
                  onChange={() => setPickedAgents((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])}
                />
                {agent.name}
              </label>
            ))}
            {!readyAgents.length && <p className="skill-quiet">이 컴퓨터에서 붙일 에이전트가 없어요. 등록만 돼요.</p>}
          </fieldset>
          <button type="submit" className="skill-action primary" disabled={busy}>등록하고 붙이기</button>
        </form>
      )}
      {notice && <p className={notice.ok ? 'skill-toast ok' : 'skill-toast bad'} role="status">{notice.text}</p>}

      <div className="skill-views" role="tablist" aria-label="보는 방법">
        <button type="button" role="tab" aria-selected={view === 'skills'} className={view === 'skills' ? 'is-on' : ''} onClick={() => setView('skills')}>스킬별로 보기</button>
        <button type="button" role="tab" aria-selected={view === 'agents'} className={view === 'agents' ? 'is-on' : ''} onClick={() => setView('agents')}>에이전트별로 보기</button>
      </div>

      {view === 'agents' ? (
        <div className="skill-agents">
          {board.agents.map((agent) => (
            <article
              key={agent.id}
              className={`skill-agent skill-card ${!agent.ready ? 'is-off' : ''}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDropAgent(agent.id, event)}
            >
              <header>
                <b>{agent.name}</b>
                <small>{agent.ready ? `스킬 ${agent.skillNames.length}개` : '연결 안 됨'}</small>
              </header>
              <div className="skill-agent-list">
                {agent.ready && agent.skillNames.length === 0 && <span className="skill-quiet">스킬을 끌어다 놓으면 붙어요</span>}
                {!agent.ready && <span className="skill-quiet">이 컴퓨터에서 아직 쓰지 않는 에이전트예요.</span>}
                {agent.skillNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="skill-tag"
                    draggable
                    onClick={() => openSkill(name, 'read')}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', `${name}\n${agent.id}`)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {agent.id !== 'agent-relay' && agent.ready && (
                <button type="button" className="skill-action skill-guide" disabled={busy} onClick={() => void toggleGuide(agent.id, !agent.guideOn)}>
                  {agent.guideOn ? '매 대화 안내 켜짐 · 끄기' : '매 대화 안내 꺼짐 · 켜기'}
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="skill-stage">
          <aside className="skill-side skill-card" aria-label="스킬 목록">
            <label className="skill-search">
              <span className="sr-only">스킬 찾기</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="스킬 찾기" />
            </label>
            {changedCount > 0 && <p className="skill-quiet">글이 바뀐 스킬 {changedCount}개 · 노란 표시예요.</p>}
            <ul
              className="skill-list"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDropShelf}
            >
              {board.skills.length === 0 && <li className="skill-quiet">아직 스킬이 없어요. 위의 "새 스킬 등록"으로 만들 수 있어요.</li>}
              {board.skills.length > 0 && !shownSkills.length && (
                <li className="skill-quiet">"{search.trim()}"에 맞는 스킬이 없어요. <button type="button" className="skill-link" onClick={() => setSearch('')}>찾기 지우기</button></li>
              )}
              {shownSkills.map((skill) => (
                <li key={skill.name}>
                  <button
                    type="button"
                    draggable
                    aria-current={pinnedId === skill.name}
                    className={`skill-row ${pinnedId === skill.name ? 'is-on' : ''}`}
                    onClick={() => openSkill(skill.name, 'read')}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', `${skill.name}\nshelf`)
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <span className="skill-row-name">{skill.name}</span>
                    <span className="skill-row-meta">
                      {skill.changed && <i className="skill-badge">바뀜</i>}
                      <span>{skill.agents.length ? `${skill.agents.length}곳에 붙음` : '안 붙음'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="skill-read skill-card">
            {pinned ? (
              <article className="skill-detail" aria-live="polite">
                <header className="skill-detail-head">
                  <div>
                    <h2>{pinned.name}</h2>
                    {skillLine && (
                      <button type="button" className={`skill-desc ${descOpen ? 'is-open' : ''}`} aria-expanded={descOpen} onClick={() => setDescOpen((open) => !open)}>
                        {skillLine}
                      </button>
                    )}
                  </div>
                  <button type="button" className="skill-action" onClick={() => setPinnedId(null)}>닫기</button>
                </header>

                {pinned.changed && (
                  <div className="skill-change">
                    <b>글이 바뀌었어요.</b>
                    <button type="button" className="skill-action primary" disabled={busy} onClick={() => void run('ack', '', pinned.name)}>확인했어요</button>
                  </div>
                )}

                <section className="skill-section" aria-label="붙은 에이전트">
                  <h3>붙은 에이전트 <small>누르면 붙이고, 다시 누르면 빼요</small></h3>
                  <div className="skill-toggles">
                    {board.agents.map((agent) => {
                      const on = pinned.agents.includes(agent.id)
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          aria-pressed={on}
                          disabled={busy || !agent.ready}
                          className={`skill-toggle ${on ? 'is-on' : ''}`}
                          onClick={() => void run(on ? 'unlink' : 'link', agent.id, pinned.name)}
                          aria-label={on ? `${agent.name}에서 빼기` : agent.ready ? `${agent.name}에 붙이기` : `${agent.name} 연결 안 됨`}
                        >
                          <span aria-hidden="true">{on ? '✓' : agent.ready ? '+' : '·'}</span>
                          {agent.name}
                        </button>
                      )
                    })}
                  </div>
                  {related.length > 0 && (
                    <p className="skill-related">
                      <span>같이 붙어 있는 스킬</span>
                      {related.map((name) => (
                        <button key={name} type="button" className="skill-tag" onClick={() => openSkill(name, 'read')}>{name}</button>
                      ))}
                    </p>
                  )}
                </section>

                <div className="skill-modes" role="tablist" aria-label="글 보기">
                  {([['read', '원문'], ['korean', '번역본'], ['edit', '글 고치기'], ['history', '이전 글']] as Array<[ReadMode, string]>).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={readMode === mode}
                      className={readMode === mode ? 'is-on' : ''}
                      disabled={busy || (mode === 'korean' && !readText)}
                      onClick={() => pickReadMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {readMode === 'history' && boardApi() && (
                  <HistoryPanel api={boardApi()!} placeId={placeId} name={pinned.name} busy={busy} onResult={(result) => void apply(result)} />
                )}
                {readMode === 'edit' && (
                  <div className="skill-form skill-form-wide">
                    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={18} aria-label="스킬 글" />
                    <p className="skill-quiet">{lineChange(original, draft)}</p>
                    <div className="skill-toolbar">
                      <button type="button" className="skill-action primary" disabled={busy} onClick={() => void saveDraft(pinned.name)}>저장</button>
                      <button type="button" className="skill-action" disabled={busy} onClick={() => setEditing(false)}>그만 고치기</button>
                    </div>
                  </div>
                )}
                {readMode === 'korean' && translating && (
                  <p className="skill-wait">번역하고 있어요. 글이 길면 1분쯤 걸려요. 끝나면 이 자리에 한글로 나와요.</p>
                )}
                {readMode === 'korean' && !translating && translateError && (
                  <div className="skill-wait">
                    <p>{translateError}</p>
                    <button type="button" className="skill-action primary" onClick={() => void showSavedTranslation(pinned.name, readText)}>다시 번역</button>
                  </div>
                )}
                {readMode === 'korean' && !translating && !translateError && koreanText && (
                  <MarkdownViewer className="skill-md" content={shownText.body} />
                )}
                {readMode === 'read' && (
                  readText
                    ? <MarkdownViewer className="skill-md" content={shownText.body} />
                    : <p className="skill-quiet">글을 열고 있어요.</p>
                )}

                {pinned.changed && (pinned.addedLines.length > 0 || pinned.removedLines.length > 0) && (
                  <details className="skill-fold">
                    <summary>바뀐 줄</summary>
                    {pinned.addedLines.length > 0 && <p>들어온 줄</p>}
                    <ul>{pinned.addedLines.map((line) => <li key={`a-${line}`}>{line}</li>)}</ul>
                    {pinned.removedLines.length > 0 && <p>빠진 줄</p>}
                    <ul>{pinned.removedLines.map((line) => <li key={`r-${line}`}>{line}</li>)}</ul>
                  </details>
                )}

                {otherPlaces.length > 0 && (
                  <details className="skill-fold">
                    <summary>다른 컴퓨터와 맞추기</summary>
                    <div className="skill-form">
                      <label>보낼 컴퓨터
                        <select value={sendTo} onChange={(event) => { setSendTo(event.target.value); setReplaceAsk(false) }}>
                          <option value="">컴퓨터를 고르세요</option>
                          {otherPlaces.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
                        </select>
                      </label>
                      <p className="skill-quiet">{pinned.agents.length ? `같이 붙는 곳: ${agentNames(board.agents, pinned.agents)}` : '아직 붙은 에이전트가 없어서 글만 보내요.'}</p>
                      {replaceAsk ? (
                        <div className="skill-change">
                          <b>그 컴퓨터에 이미 있어요. 글을 바꿀까요?</b>
                          <button type="button" className="skill-action" disabled={busy} onClick={() => setReplaceAsk(false)}>그대로 두기</button>
                          <button type="button" className="skill-action primary" disabled={busy} onClick={() => void sendSkill(pinned.name, true)}>바꾸고 붙이기</button>
                        </div>
                      ) : (
                        <div className="skill-toolbar">
                          <button type="button" className="skill-action primary" disabled={busy || !sendTo} onClick={() => void sendSkill(pinned.name, false)}>보내고 붙이기</button>
                          <button type="button" className="skill-action" disabled={busy} onClick={() => void lookForCopies(pinned.name)}>있는 곳 모두 이 글로 맞추기</button>
                        </div>
                      )}
                      {reflectAsk && (
                        <div className="skill-change">
                          <b>다른 컴퓨터의 글을 이 글로 바꿀까요?</b>
                          <button type="button" className="skill-action" disabled={busy} onClick={() => setReflectAsk(false)}>그대로 두기</button>
                          <button type="button" className="skill-action primary" disabled={busy} onClick={() => void reflectCopies(pinned.name)}>바꿔 반영</button>
                        </div>
                      )}
                    </div>
                  </details>
                )}

                <footer className="skill-detail-foot">
                  {trashAsk ? (
                    <div className="skill-change">
                      <b>{pinned.agents.length ? `붙은 곳 ${pinned.agents.length}곳에서 모두 빠지고 휴지통으로 가요.` : '휴지통으로 옮겨요.'} 휴지통에서 다시 꺼낼 수 있어요.</b>
                      <button type="button" className="skill-action primary" disabled={busy} onClick={() => setTrashAsk(false)}>그대로 두기</button>
                      <button type="button" className="skill-action" disabled={busy} onClick={() => void trashPinned(pinned.name)}>휴지통으로 옮기기</button>
                    </div>
                  ) : (
                    <button type="button" className="skill-link" disabled={busy} onClick={() => setTrashAsk(true)}>이 스킬 지우기</button>
                  )}
                  <p className="skill-quiet">영어 원문은 그대로 에이전트에 가요. 번역본은 이 컴퓨터에만 저장돼서, 같은 글은 다시 번역하지 않아요.</p>
                </footer>
              </article>
            ) : (
              <div className="skill-empty">
                <b>왼쪽에서 스킬을 골라 주세요.</b>
                <p className="skill-quiet">고른 스킬의 글, 붙은 에이전트, 번역본이 여기에 한꺼번에 보여요.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** Other skills that share an agent with this one, most shared first. */
function relatedSkills(board: SkillBoard, skill: BoardSkill): string[] {
  return board.skills
    .filter((other) => other.name !== skill.name)
    .map((other) => ({ name: other.name, shared: other.agents.filter((id) => skill.agents.includes(id)).length }))
    .filter((item) => item.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((item) => item.name)
}

function agentNames(agents: BoardAgent[], ids: string[]): string {
  return ids.map((id) => agents.find((agent) => agent.id === id)?.name ?? id).join(', ')
}

function lineChange(before: string, after: string): string {
  const oldLines = new Set(before.split('\n').map((line) => line.trim()).filter(Boolean))
  const newLines = after.split('\n').map((line) => line.trim()).filter(Boolean)
  const added = newLines.filter((line) => !oldLines.has(line)).length
  const removed = [...oldLines].filter((line) => !newLines.includes(line)).length
  if (!added && !removed) return '아직 바뀐 줄이 없어요.'
  return `${added}줄이 들어오고 ${removed}줄이 빠집니다.`
}
