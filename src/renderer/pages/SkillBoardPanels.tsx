import { useCallback, useEffect, useState } from 'react'
import { compareMoves, whenText, type BoardApi, type BoardResult, type CompareColumn, type CompareRow, type SkillVersion, type TrashItem } from './skill-board-api'

/** First-run guide: what this is, the one move to learn, and what the amber mark means. */
export function IntroGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="skill-intro" aria-label="처음 쓰는 방법">
      <b>스킬 보드는 이렇게 써요</b>
      <ol>
        <li><strong>스킬</strong>은 AI에게 주는 일하는 방법이에요. 위 칸에 모여 있어요.</li>
        <li>스킬을 <strong>에이전트 카드 위로 끌어다 놓으면</strong> 붙어요. 카드에서 빼도 스킬 글은 남아요.</li>
        <li>노란 <strong>바뀜</strong>은 누가 글을 고쳤다는 뜻이에요. 눌러서 바뀐 줄을 보고 확인하세요.</li>
      </ol>
      <button type="button" className="skill-action primary" onClick={onClose}>알겠어요</button>
    </section>
  )
}

/** Older texts of one skill with a restore button on each. */
export function HistoryPanel({ api, placeId, name, busy, onResult }: {
  api: BoardApi
  placeId: string
  name: string
  busy: boolean
  onResult: (result: BoardResult) => void
}) {
  const [versions, setVersions] = useState<SkillVersion[] | null>(null)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setVersions(null)
    try {
      const result = await api.skillBoardHistory(placeId, name)
      setVersions(result.versions)
      setMessage(result.message)
    } catch {
      setVersions([])
      setMessage('이전 글을 읽지 못했어요. 다시 시도해 주세요.')
    }
  }, [api, placeId, name])

  useEffect(() => { void load() }, [load])

  async function restore(id: string) {
    setWorking(true)
    try {
      onResult(await api.skillBoardRestore(placeId, name, id))
      await load()
    } catch {
      setMessage('되돌리지 못했어요. 다시 시도해 주세요.')
    } finally {
      setWorking(false)
    }
  }

  if (versions === null) return <p className="skill-quiet">이전 글을 찾고 있어요.</p>
  return (
    <div className="skill-history">
      {message && <p className="skill-quiet">{message}</p>}
      <ul>
        {versions.map((version) => (
          <li key={version.id}>
            <span>{whenText(version.when)} · {version.diff ? `지금 글과 ${version.diff}줄 달라요` : '지금 글과 같아요'}</span>
            <button type="button" className="skill-action" disabled={busy || working || !version.diff} onClick={() => void restore(version.id)}>이 글로 되돌리기</button>
          </li>
        ))}
      </ul>
      <p className="skill-quiet">되돌려도 방금 글은 여기 남아서, 다시 되돌릴 수 있어요.</p>
    </div>
  )
}

/** Skills moved to the trash on this computer, with a way to bring each back. */
export function TrashPanel({ api, placeId, busy, onResult }: {
  api: BoardApi
  placeId: string
  busy: boolean
  onResult: (result: BoardResult) => void
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setItems(null)
    try {
      const result = await api.skillBoardTrashList(placeId)
      setItems(result.items)
      setMessage(result.message)
    } catch {
      setItems([])
      setMessage('휴지통을 읽지 못했어요. 다시 시도해 주세요.')
    }
  }, [api, placeId])

  useEffect(() => { void load() }, [load])

  async function bringBack(id: string) {
    setWorking(true)
    try {
      onResult(await api.skillBoardUntrash(placeId, id))
      await load()
    } catch {
      setMessage('꺼내지 못했어요. 다시 시도해 주세요.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="skill-panel" aria-label="휴지통">
      <b>휴지통</b>
      {items === null && <p className="skill-quiet">휴지통을 열고 있어요.</p>}
      {message && <p className="skill-quiet">{message}</p>}
      <ul>
        {(items ?? []).map((item) => (
          <li key={item.id}>
            <span>{item.name} · {whenText(item.when)} 지움</span>
            <button type="button" className="skill-action primary" disabled={busy || working} onClick={() => void bringBack(item.id)}>다시 꺼내기</button>
          </li>
        ))}
      </ul>
      {(items ?? []).length > 0 && <p className="skill-quiet">꺼내면 전에 붙어 있던 에이전트에 다시 붙어요.</p>}
    </section>
  )
}

const STATE_TEXT: Record<string, string> = {
  base: '지금 보는 곳',
  same: '같음',
  different: '다름',
  missing: '없음',
  unknown: '연결 안 됨',
}

/** Every computer side by side: does it have this skill, and is the text the same. */
type CompareAsk = { name: string; kind: 'align' | 'send' | 'bring'; ids: string[]; label: string }

export function ComparePanel({ api, placeId, busy, onPick, onChanged }: {
  api: BoardApi
  placeId: string
  busy: boolean
  onPick: (name: string) => void
  onChanged: (result: BoardResult) => void
}) {
  const [data, setData] = useState<{ columns: CompareColumn[]; rows: CompareRow[] } | null>(null)
  const [failed, setFailed] = useState('')
  const [ask, setAsk] = useState<CompareAsk | null>(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setData(null)
    setFailed('')
    try {
      setData(await api.skillBoardCompare(placeId))
    } catch {
      setFailed('컴퓨터들을 읽지 못했어요. 다시 시도해 주세요.')
    }
  }, [api, placeId])

  useEffect(() => { void load() }, [load])

  const names = new Map((data?.columns ?? []).map((column) => [column.id, column.name]))

  async function runAsk() {
    if (!ask) return
    setWorking(true)
    const notes: string[] = []
    let ok = true
    try {
      if (ask.kind === 'align') {
        const result = await api.skillBoardReflect(placeId, ask.name, ask.ids)
        notes.push(result.message)
        ok = result.ok
      } else if (ask.kind === 'send') {
        for (const id of ask.ids) {
          const result = await api.skillBoardSend(placeId, id, ask.name, false)
          notes.push(result.message)
          ok = ok && result.ok
        }
      } else {
        const result = await api.skillBoardSend(ask.ids[0], placeId, ask.name, false)
        notes.push(result.message)
        ok = result.ok
      }
      onChanged({ ok, message: notes.filter(Boolean).join(' '), board: { agents: [], skills: [] } })
      setAsk(null)
      await load()
    } catch {
      setFailed('지금 반영하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setWorking(false)
    }
  }

  const offline = data?.columns.filter((column) => !column.ok) ?? []
  const differing = data?.rows.filter((row) => Object.values(row.cells).some((state) => state === 'different')).length ?? 0

  return (
    <section className="skill-panel" aria-label="컴퓨터끼리 비교">
      <b>컴퓨터끼리 비교</b>
      {!data && !failed && <p className="skill-quiet">모든 컴퓨터를 읽고 있어요. 조금 걸릴 수 있어요.</p>}
      {failed && (
        <>
          <p className="skill-quiet">{failed}</p>
          <button type="button" className="skill-action" onClick={() => void load()}>다시 시도</button>
        </>
      )}
      {data && (
        <>
          <p className="skill-quiet">
            {differing ? `글이 다른 스킬이 ${differing}개 있어요. 각 줄의 버튼으로 맞추거나 가져올 수 있어요.` : '있는 곳끼리는 글이 모두 같아요.'}
          </p>
          {ask && (
            <div className="skill-change">
              <b>{ask.label}</b>
              <button type="button" className="skill-action primary" disabled={busy || working} onClick={() => setAsk(null)}>그대로 두기</button>
              <button type="button" className="skill-action" disabled={busy || working} onClick={() => void runAsk()}>
                {ask.kind === 'align' ? '이 글로 맞추기' : ask.kind === 'send' ? '보내기' : '가져오기'}
              </button>
            </div>
          )}
          {offline.map((column) => <p key={column.id} className="skill-quiet">{column.name}: {column.problem}</p>)}
          <ul className="compare-rows">
            {data.rows.map((row) => {
              const moves = compareMoves(placeId, row.cells)
              const listed = (ids: string[]) => ids.map((id) => names.get(id) ?? id).join(', ')
              return (
                <li key={row.name}>
                  <button type="button" className="compare-name" onClick={() => onPick(row.name)}>{row.name}</button>
                  <span className="compare-cells">
                    {data.columns.map((column) => {
                      const state = row.cells[column.id] ?? 'missing'
                      return <span key={column.id} className={`compare-cell is-${state}`}>{column.name} {STATE_TEXT[state]}</span>
                    })}
                  </span>
                  <span className="skill-toolbar">
                    {moves.align.length > 0 && (
                      <button type="button" className="skill-action" disabled={busy || working} onClick={() => setAsk({ name: row.name, kind: 'align', ids: moves.align, label: `${listed(moves.align)}의 글을 지금 보는 글과 같게 바꿀까요?` })}>다른 곳 글을 이 글로 맞추기</button>
                    )}
                    {moves.send.length > 0 && (
                      <button type="button" className="skill-action" disabled={busy || working} onClick={() => setAsk({ name: row.name, kind: 'send', ids: moves.send, label: `${listed(moves.send)}에는 이 스킬이 없어요. 보낼까요?` })}>없는 곳으로 보내기</button>
                    )}
                    {moves.bring.map((id) => (
                      <button key={id} type="button" className="skill-action" disabled={busy || working} onClick={() => setAsk({ name: row.name, kind: 'bring', ids: [id], label: `${names.get(id) ?? id}에 있는 글을 이 컴퓨터로 가져올까요?` })}>{names.get(id) ?? id}에서 가져오기</button>
                    ))}
                  </span>
                </li>
              )
            })}
          </ul>
          <button type="button" className="skill-action" onClick={() => void load()}>다시 읽기</button>
        </>
      )}
    </section>
  )
}
