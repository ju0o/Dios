import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { OTHER_PLATFORM, PLATFORMS, USAGE_TYPES, groupByProject, headline, usageLine, type ApiKeyCard, type ApiKeyInput } from '../../core/api-keys/api-key-text'
import { healthLabel } from '../../core/api-keys/key-health'
import { apiKeysApi, type DiscoveryPlaceChoice, type KeyListing, type KeyResult, type PublicCandidate, type ScanOrigin, type ScanResult, type ScanRootResult } from './api-keys-api'
import { whenText } from './skill-board-api'

type Notice = { ok: boolean; text: string; undoId?: string; undoEnv?: boolean } | null

const EMPTY_FORM: ApiKeyInput = { project: '', platform: PLATFORMS[0], label: '', key: '', note: '' }
const SHOW_ALL_KEY = 'dios.apiKeys.showAll'
const SCANNED_KEY = 'dios.apiKeys.scannedOnce'
const EMPTY_LISTING: KeyListing = { cards: [], projects: [], locked: true, usage: [], scanRoots: [], scanRootOrigins: {} }

const ORIGIN_LABEL: Record<ScanOrigin, string> = { picked: '직접 고른 폴더', project: '연동한 프로젝트 폴더', default: '흔히 쓰는 프로젝트 폴더' }

function remembered(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function remember(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // Storage may be off; the toggle just does not persist.
  }
}

/**
 * Founder screen for the API keys each project uses.
 * This is the Founder's own computer, so the screen leans on convenience:
 * delete has 되돌리기 instead of a question, keys can stay visible, and project folders are scanned for keys.
 */
export function ApiKeysView() {
  const [listing, setListing] = useState<KeyListing | null>(null)
  const [failed, setFailed] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [checking, setChecking] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ApiKeyInput>(EMPTY_FORM)
  const [otherPlatform, setOtherPlatform] = useState('')
  const [open, setOpen] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(() => remembered(SHOW_ALL_KEY))
  const [filter, setFilter] = useState('')
  /** Per-folder outcome of the last scan, keyed by folder, so each row says what happened there. */
  const [lastScan, setLastScan] = useState<{ at: number; rows: Record<string, ScanRootResult> }>({ at: 0, rows: {} })
  const [scanningRoot, setScanningRoot] = useState('')
  const [candidates, setCandidates] = useState<PublicCandidate[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [placeNotes, setPlaceNotes] = useState<string[]>([])
  const [lead, setLead] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [discoverPlaces, setDiscoverPlaces] = useState<DiscoveryPlaceChoice[]>([])
  const [discoverPick, setDiscoverPick] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const api = apiKeysApi()
    if (!api) {
      setFailed('이 화면은 Dios 앱에서 열려요.')
      setListing(EMPTY_LISTING)
      return
    }
    try {
      setListing(await api.apiKeysList())
      setFailed('')
    } catch {
      setFailed('키 목록을 읽지 못했어요.')
      setListing(EMPTY_LISTING)
    }
  }, [])

  const takeScan = useCallback((result: ScanResult, quiet: boolean) => {
    setListing(result.listing)
    if (result.scannedAt) {
      setLastScan((current) => ({ at: result.scannedAt, rows: { ...current.rows, ...Object.fromEntries(result.roots.map((row) => [row.root, row])) } }))
    }
    if (result.candidates) {
      setCandidates(result.candidates)
      setPicked(Object.fromEntries(result.candidates.map((row) => [row.id, true])))
    }
    if (result.notes) setPlaceNotes(result.notes)
    if (typeof result.lead === 'string') setLead(result.lead)
    const fresh = result.candidates?.length ?? 0
    if (result.message && (!quiet || fresh > 0)) setNotice({ ok: result.ok, text: result.message })
  }, [])

  const revealAll = useCallback(async () => {
    const api = apiKeysApi()
    if (!api) return
    try {
      setOpen(await api.apiKeysPeekAll())
    } catch {
      setNotice({ ok: false, text: '키를 보여주지 못했어요. 다시 시도해 주세요.' })
    }
  }, [])

  /** Scan every known folder (quiet on the first visit), or only one folder from its row. */
  const scan = useCallback(async (quiet: boolean, onlyRoot?: string) => {
    const api = apiKeysApi()
    if (!api) return
    setScanning(true)
    setScanningRoot(onlyRoot ?? '')
    try {
      takeScan(await api.apiKeysScan(onlyRoot ? [onlyRoot] : undefined), quiet)
    } catch {
      if (!quiet) setNotice({ ok: false, text: '폴더를 훑지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setScanning(false)
      setScanningRoot('')
    }
  }, [takeScan])

  /** Open the place list. Nothing is contacted until the Founder presses the search button. */
  const openDiscover = useCallback(async () => {
    const api = apiKeysApi()
    if (!api?.apiKeysDiscoveryPlaces) return
    if (discoverOpen) {
      setDiscoverOpen(false)
      return
    }
    try {
      const listed = await api.apiKeysDiscoveryPlaces()
      setDiscoverPlaces(listed.places)
      setDiscoverPick(Object.fromEntries(listed.places.map((place) => [place.id, listed.selectedIds.includes(place.id)])))
      setDiscoverOpen(true)
    } catch {
      setNotice({ ok: false, text: '찾을 위치 목록을 읽지 못했어요.' })
    }
  }, [discoverOpen])

  /** Search only the checked places. A remote place that is off is not contacted. */
  const discover = useCallback(async () => {
    const api = apiKeysApi()
    if (!api?.apiKeysDiscover) return
    const ids = discoverPlaces.filter((place) => discoverPick[place.id]).map((place) => place.id)
    if (!ids.length) {
      setNotice({ ok: false, text: '찾을 위치를 하나 골라 주세요.' })
      return
    }
    setDiscovering(true)
    try {
      takeScan(await api.apiKeysDiscover(ids), false)
    } catch {
      setNotice({ ok: false, text: '프로젝트를 찾지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setDiscovering(false)
    }
  }, [takeScan, discoverPlaces, discoverPick])

  const saveCandidates = useCallback(async (ids: string[]) => {
    const api = apiKeysApi()
    if (!api?.apiKeysSaveCandidates || !ids.length) return
    setBusy(true)
    try {
      takeScan(await api.apiKeysSaveCandidates(ids), false)
    } catch {
      setNotice({ ok: false, text: '키를 저장하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }, [takeScan])

  const dismissCandidates = useCallback(async () => {
    const api = apiKeysApi()
    if (!api?.apiKeysDismissCandidates) return
    setBusy(true)
    try {
      takeScan(await api.apiKeysDismissCandidates(candidates.map((row) => row.id)), false)
    } catch {
      setNotice({ ok: false, text: '이번 목록을 치우지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }, [takeScan, candidates])

  /** The Founder picks folders; those are remembered and scanned right away. */
  const pickAndScan = useCallback(async () => {
    const api = apiKeysApi()
    if (!api) return
    setScanning(true)
    try {
      takeScan(await api.apiKeysScanPick(), false)
    } catch {
      setNotice({ ok: false, text: '폴더를 고르지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setScanning(false)
    }
  }, [takeScan])

  useEffect(() => { void load() }, [load])

  // First visit: look through project folders once so the list is not empty on day one.
  useEffect(() => {
    if (!listing || remembered(SCANNED_KEY)) return
    remember(SCANNED_KEY, true)
    void scan(true)
  }, [listing, scan])

  useEffect(() => {
    if (showAll) void revealAll()
  }, [showAll, listing?.cards.length, revealAll])

  function setCards(cards: ApiKeyCard[]) {
    setListing((current) => (current ? { ...current, cards } : current))
  }

  function apply(result: KeyResult, undo: { id?: string; env?: boolean } = {}) {
    setCards(result.cards)
    setNotice({ ok: result.ok, text: result.message, undoId: result.ok ? undo.id : '', undoEnv: result.ok ? undo.env : false })
    return result.ok
  }

  function openNew() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, project: form.project || listing?.projects[0] || '' })
    setOtherPlatform('')
    setFormOpen(true)
  }

  function openEdit(card: ApiKeyCard) {
    const known = PLATFORMS.includes(card.platform)
    setEditingId(card.id)
    setForm({ project: card.project, platform: known ? card.platform : OTHER_PLATFORM, label: card.label, key: '', note: card.note })
    setOtherPlatform(known ? '' : card.platform)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setOtherPlatform('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const api = apiKeysApi()
    if (!api) return
    const platform = form.platform === OTHER_PLATFORM ? otherPlatform.trim() : form.platform
    if (form.platform === OTHER_PLATFORM && !platform) {
      setNotice({ ok: false, text: '플랫폼 이름을 적어 주세요.' })
      return
    }
    setBusy(true)
    try {
      const payload = { ...form, platform }
      const result = editingId ? await api.apiKeysUpdate(editingId, payload) : await api.apiKeysAdd(payload)
      if (apply(result, { env: 'undoEnv' in result && Boolean(result.undoEnv) })) {
        closeForm()
        void load()
      }
    } catch {
      setNotice({ ok: false, text: '저장하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    const api = apiKeysApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.apiKeysDelete(id)
      apply(result, { id: result.undoId })
      if (editingId === id) closeForm()
    } catch {
      setNotice({ ok: false, text: '지우지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  async function undo(id: string, env: boolean) {
    const api = apiKeysApi()
    if (!api) return
    setBusy(true)
    try {
      apply(env ? await api.apiKeysUndoEnv() : await api.apiKeysUndoDelete(id))
      void load()
    } catch {
      setNotice({ ok: false, text: '되돌리지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }

  async function checkKeys() {
    const api = apiKeysApi()
    if (!api) return
    setChecking(true)
    try {
      const result = await api.apiKeysCheck()
      setListing(result.listing)
      setNotice({ ok: result.ok, text: result.message })
    } catch {
      setNotice({ ok: false, text: '키를 확인하지 못했어요. 인터넷을 확인해 주세요.' })
    } finally {
      setChecking(false)
    }
  }

  async function copy(id: string) {
    const api = apiKeysApi()
    if (!api) return
    try {
      const result = await api.apiKeysCopy(id)
      setNotice({ ok: result.ok, text: result.message })
    } catch {
      setNotice({ ok: false, text: '복사하지 못했어요. 다시 시도해 주세요.' })
    }
  }

  async function togglePeek(id: string) {
    if (open[id]) {
      setOpen((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      return
    }
    const api = apiKeysApi()
    if (!api) return
    try {
      const result = await api.apiKeysPeek(id)
      if (!result.ok) {
        setNotice({ ok: false, text: result.message })
        return
      }
      setOpen((current) => ({ ...current, [id]: result.key }))
    } catch {
      setNotice({ ok: false, text: '키를 보여주지 못했어요. 다시 시도해 주세요.' })
    }
  }

  function toggleShowAll() {
    const next = !showAll
    setShowAll(next)
    remember(SHOW_ALL_KEY, next)
    if (!next) setOpen({})
  }

  async function dropFolder(root: string) {
    const api = apiKeysApi()
    if (!api) return
    try {
      const result = await api.apiKeysRemoveScanRoot(root)
      setListing(result.listing)
      setLastScan((current) => {
        const rows = { ...current.rows }
        delete rows[root]
        return { ...current, rows }
      })
      setNotice({ ok: result.ok, text: result.message })
    } catch {
      setNotice({ ok: false, text: '폴더를 빼지 못했어요.' })
    }
  }

  async function openFolder(root: string) {
    const api = apiKeysApi()
    if (!api) return
    try {
      const result = await api.apiKeysOpenScanRoot(root)
      if (!result.ok) setNotice({ ok: false, text: result.message })
    } catch {
      setNotice({ ok: false, text: '폴더를 열지 못했어요.' })
    }
  }

  async function refreshUsage() {
    const api = apiKeysApi()
    if (!api) return
    setBusy(true)
    try {
      const result = await api.apiKeysRefreshUsage()
      setListing(result.listing)
      setNotice({ ok: result.ok, text: result.message })
    } catch {
      setNotice({ ok: false, text: '사용량을 못 받았어요. 인터넷을 확인해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  if (listing === null) {
    return <section className="skill-board"><p className="skill-lead">API 키 목록을 읽고 있어요.</p></section>
  }
  if (failed) {
    return (
      <section className="skill-board">
        <p className="skill-lead">{failed}</p>
        {apiKeysApi() && <button type="button" className="skill-action" onClick={() => void load()}>다시 시도</button>}
      </section>
    )
  }

  const { cards, projects, locked, usage, scanRoots, scanRootOrigins } = listing
  const query = filter.trim().toLowerCase()
  const shown = query
    ? cards.filter((card) => [card.project, card.platform, card.label, card.note].some((text) => text.toLowerCase().includes(query)))
    : cards
  const groups = groupByProject(shown)
  const usageById = new Map(usage.map((snapshot) => [snapshot.serviceId, snapshot]))
  const hasUsageKeys = cards.some((card) => USAGE_TYPES[card.platform])

  return (
    <section className="skill-board" aria-label="API 키 관리">
      <header className="skill-top">
        <p className="skill-lead">{headline(cards)}</p>
        <div className="skill-toolbar">
          <button type="button" className="skill-action primary" onClick={() => (formOpen && !editingId ? closeForm() : openNew())}>
            {formOpen && !editingId ? '등록 닫기' : '새 키 등록'}
          </button>
          <button type="button" className="skill-action" disabled={scanning || discovering} onClick={() => void pickAndScan()}>
            {scanning && !scanningRoot ? '폴더를 훑는 중…' : '폴더 골라서 키 찾기'}
          </button>
          {scanRoots.length > 0 && (
            <button type="button" className="skill-action" disabled={scanning || discovering} onClick={() => void scan(false)}>
              {`아래 폴더 ${scanRoots.length}곳 모두 훑기`}
            </button>
          )}
          <button type="button" className="skill-action" disabled={scanning || discovering} aria-expanded={discoverOpen} onClick={() => void openDiscover()}>
            {discovering ? '프로젝트를 찾는 중…' : '새 프로젝트 찾기'}
          </button>
          {cards.length > 0 && (
            <button type="button" className="skill-action" disabled={checking} onClick={() => void checkKeys()}>
              {checking ? '키를 확인하는 중…' : '키 상태 확인'}
            </button>
          )}
          {hasUsageKeys && (
            <button type="button" className="skill-action" disabled={busy} onClick={() => void refreshUsage()}>사용량 새로 조회</button>
          )}
          {cards.length > 0 && (
            <button type="button" className="skill-action" aria-pressed={showAll} onClick={toggleShowAll}>
              {showAll ? '키 전부 가리기' : '키 전부 보기'}
            </button>
          )}
        </div>
      </header>

      {discoverOpen && (
        <section className="skill-card discover-places" aria-label="탐색 위치">
          <b>탐색 위치</b>
          <div className="discover-place-list">
            {discoverPlaces.map((place) => (
              <label key={place.id} className="key-candidate-row">
                <input
                  type="checkbox"
                  checked={discoverPick[place.id] === true}
                  aria-label={place.name}
                  onChange={(event) => setDiscoverPick((current) => ({ ...current, [place.id]: event.target.checked }))}
                />
                <span>{place.name}</span>
              </label>
            ))}
          </div>
          <div className="skill-toolbar">
            <button type="button" className="skill-action primary" disabled={discovering} onClick={() => void discover()}>
              {discovering ? '프로젝트를 찾는 중…' : '선택한 위치에서 찾기'}
            </button>
          </div>
        </section>
      )}

      {(candidates.length > 0 || placeNotes.length > 0 || lead) && (
        <CandidateCard
          lead={lead}
          notes={placeNotes}
          candidates={candidates}
          picked={picked}
          busy={busy}
          onPick={(id, on) => setPicked((current) => ({ ...current, [id]: on }))}
          onSaveSelected={() => void saveCandidates(candidates.filter((row) => picked[row.id] !== false).map((row) => row.id))}
          onSaveAll={() => void saveCandidates(candidates.map((row) => row.id))}
          onIgnore={() => void dismissCandidates()}
        />
      )}

      <section className="skill-card scan-report" aria-label="훑는 폴더와 결과">
        <header className="scan-report-head">
          <b>{scanRoots.length ? `훑는 폴더 ${scanRoots.length}곳` : '아직 훑는 폴더가 없어요'}</b>
          {lastScan.at > 0 && <small>마지막 훑기 {whenText(lastScan.at)}</small>}
        </header>
        <div className="scan-pick">
          <p className="skill-quiet">
            {scanRoots.length
              ? '폴더마다 어디를 훑었고 무엇이 나왔는지 그대로 보여요. 프로젝트가 다른 곳에 있으면 위의 "폴더 골라서 키 찾기"로 그 폴더를 바로 고르세요.'
              : '위의 "폴더 골라서 키 찾기"를 눌러 프로젝트 폴더를 고르면, 그 안의 .env 파일에서 API 키를 찾아 보여 줘요. 고른 것만 저장해요.'}
          </p>
        </div>
        {scanRoots.length > 0 && (
          <ul className="scan-rows">
            {scanRoots.map((root) => {
              const row = lastScan.rows[root]
              const state = !row ? '' : !row.exists ? 'is-missing' : row.found > 0 ? 'is-found' : 'is-empty'
              const busyHere = scanning && scanningRoot === root
              return (
                <li key={root} className={`scan-row ${state}`}>
                  <i aria-hidden="true" />
                  <div className="scan-row-main">
                    <code>{root}</code>
                    <small>{ORIGIN_LABEL[scanRootOrigins[root] ?? 'default']}</small>
                    <small className="is-why">{busyHere ? '지금 훑는 중…' : row ? row.line : '아직 안 훑었어요.'}</small>
                  </div>
                  <div className="scan-row-actions">
                    <button type="button" className="skill-link" disabled={scanning || discovering} onClick={() => void scan(false, root)}>이 폴더만 훑기</button>
                    <button type="button" className="skill-link" onClick={() => void openFolder(root)}>열기</button>
                    <button type="button" className="skill-link" onClick={() => void dropFolder(root)}>빼기</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {!locked && cards.length > 0 && (
        <p className="skill-quiet" role="status">이 컴퓨터는 키 잠금을 지원하지 않아서 키가 그대로 저장돼요. 혼자 쓰는 컴퓨터라면 괜찮아요.</p>
      )}

      {formOpen && (
        <form className="skill-form skill-card" onSubmit={(event) => void submit(event)}>
          <b>{editingId ? '키 정보 고치기' : '새 키 등록'}</b>
          <label>
            프로젝트
            <input list="dios-key-projects" value={form.project} onChange={(event) => setForm({ ...form, project: event.target.value })} placeholder="예: Dios, JuPlan" autoComplete="off" required />
            <datalist id="dios-key-projects">{projects.map((name) => <option key={name} value={name} />)}</datalist>
          </label>
          <label>
            플랫폼
            <select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>
              {PLATFORMS.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value={OTHER_PLATFORM}>{OTHER_PLATFORM} (직접 적기)</option>
            </select>
          </label>
          {form.platform === OTHER_PLATFORM && (
            <label>플랫폼 이름<input value={otherPlatform} onChange={(event) => setOtherPlatform(event.target.value)} placeholder="예: Naver Cloud" autoComplete="off" /></label>
          )}
          <label>부르는 이름 <small className="skill-quiet">(선택) 같은 플랫폼 키가 여럿일 때 구분용</small><input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="예: 운영용, 시험용" autoComplete="off" /></label>
          <label>
            API 키 {editingId && <small className="skill-quiet">(비워 두면 지금 키 그대로)</small>}
            <input type="text" value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} placeholder={editingId ? '바꿀 때만 새 키를 붙여 넣어요' : '여기에 붙여 넣어요'} autoComplete="off" spellCheck={false} />
          </label>
          <label>메모 <small className="skill-quiet">(선택)</small><textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} rows={2} placeholder="예: 월 한도 20달러, 결제 계정은 회사 카드" /></label>
          <div className="skill-toolbar">
            <button type="submit" className="skill-action primary" disabled={busy}>{editingId ? '고친 대로 저장' : '등록'}</button>
            <button type="button" className="skill-action" disabled={busy} onClick={closeForm}>취소</button>
          </div>
        </form>
      )}

      {notice && (
        <p className={notice.ok ? 'skill-toast ok' : 'skill-toast bad'} role="status">
          {notice.text}
          {(notice.undoId || notice.undoEnv) && (
            <button type="button" className="skill-link" disabled={busy} onClick={() => void undo(notice.undoId || '', Boolean(notice.undoEnv))}>되돌리기</button>
          )}
        </p>
      )}

      {cards.length > 3 && (
        <label className="skill-search key-search">
          <span className="sr-only">키 찾기</span>
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="프로젝트나 플랫폼으로 찾기" />
        </label>
      )}

      {cards.length > 0 && !shown.length && (
        <p className="skill-quiet">"{filter.trim()}"에 맞는 키가 없어요. <button type="button" className="skill-link" onClick={() => setFilter('')}>찾기 지우기</button></p>
      )}

      <div className="key-groups">
        {groups.map((group) => (
          <section key={group.project} className="key-group skill-card" aria-label={`${group.project} 프로젝트의 키`}>
            <header className="key-group-head">
              <h2>{group.project}</h2>
              <small>키 {group.cards.length}개</small>
            </header>
            <ul className="key-list">
              {group.cards.map((card) => {
                const shownKey = open[card.id]
                const usageText = USAGE_TYPES[card.platform] ? usageLine(usageById.get(card.serviceId), Boolean(card.serviceId)) : ''
                return (
                  <li key={card.id} className="key-row">
                    <div className="key-main">
                      <b>{card.platform}{card.label ? <span className="key-label"> · {card.label}</span> : null}{card.health ? <span className={`key-health is-${card.health}`}>{healthLabel(card.health)}</span> : null}</b>
                      <code className={`key-mask ${shownKey ? 'is-open' : ''}`} aria-live="polite">{shownKey || card.masked}</code>
                      <small className="key-meta">
                        {whenText(card.updatedAt)} 저장
                        {card.source && ' · 폴더에서 찾음'}
                        {card.note && ` · ${card.note}`}
                      </small>
                      {usageText && <small className="key-usage">{usageText}</small>}
                      {card.source && (
                        <details className="skill-raw">
                          <summary>원문 보기</summary>
                          <code>{card.source}</code>
                        </details>
                      )}
                    </div>
                    <div className="key-actions">
                      <button type="button" className="skill-action" onClick={() => void copy(card.id)}>복사</button>
                      {!showAll && (
                        <button type="button" className="skill-action" aria-pressed={Boolean(shownKey)} onClick={() => void togglePeek(card.id)}>{shownKey ? '가리기' : '보기'}</button>
                      )}
                      <button type="button" className="skill-action" onClick={() => openEdit(card)}>고치기</button>
                      <button type="button" className="skill-action" disabled={busy} onClick={() => void remove(card.id)}>지우기</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {cards.length === 0 && !formOpen && (
        <p className="skill-quiet">
          등록하면 어느 프로젝트가 어떤 플랫폼과 이어져 있는지 한눈에 보여요. 위의 "새 프로젝트 찾기"로 프로젝트 폴더의 .env를 보면, 고른 키만 저장해요.
        </p>
      )}
    </section>
  )
}

/** Keys found in a project, still waiting for a yes. Only the masked copy is on screen. */
function CandidateCard({
  lead,
  notes,
  candidates,
  picked,
  busy,
  onPick,
  onSaveSelected,
  onSaveAll,
  onIgnore,
}: {
  lead: string
  notes: string[]
  candidates: PublicCandidate[]
  picked: Record<string, boolean>
  busy: boolean
  onPick: (id: string, on: boolean) => void
  onSaveSelected: () => void
  onSaveAll: () => void
  onIgnore: () => void
}) {
  const groups = groupCandidates(candidates)
  const selected = candidates.filter((row) => picked[row.id] !== false).length
  return (
    <section className="skill-card key-candidates" aria-label="새로 찾은 API 키">
      <header className="scan-report-head">
        <b>{lead || (candidates.length ? '새 프로젝트에서 키를 찾았어요' : '다른 컴퓨터')}</b>
      </header>
      {notes.map((note) => <p key={note} className="skill-quiet">{note}</p>)}
      {groups.map((group) => (
        <div key={group.key} className="key-candidate-group">
          <b>{group.title}</b>
          {group.path && <small className="skill-quiet">{group.path}</small>}
          {group.rows.map((row) => (
            <label key={row.id} className="key-candidate-row">
              <input
                type="checkbox"
                checked={picked[row.id] !== false}
                aria-label={`${row.platform} ${row.label} 저장`}
                onChange={(event) => onPick(row.id, event.target.checked)}
              />
              <span className="key-candidate-main">
                <b>{row.platform}</b>
                <code>{row.label}</code>
                <code>{row.masked}</code>
                <small>{row.source}</small>
              </span>
            </label>
          ))}
        </div>
      ))}
      {candidates.length > 0 && (
        <div className="skill-toolbar">
          <button type="button" className="skill-action primary" disabled={busy || selected === 0} onClick={onSaveSelected}>
            {`선택한 ${selected}개 저장`}
          </button>
          <button type="button" className="skill-action" disabled={busy} onClick={onSaveAll}>전부 저장</button>
          <button type="button" className="skill-action" disabled={busy} onClick={onIgnore}>이번엔 무시</button>
        </div>
      )}
    </section>
  )
}

function groupCandidates(rows: PublicCandidate[]): Array<{ key: string; title: string; path: string; rows: PublicCandidate[] }> {
  const groups: Array<{ key: string; title: string; path: string; rows: PublicCandidate[] }> = []
  for (const row of rows) {
    const key = `${row.project}\0${row.placeId}\0${row.projectPath}`
    let group = groups.find((item) => item.key === key)
    if (!group) {
      group = { key, title: `${row.project} · ${row.placeName}`, path: row.projectPath, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}
