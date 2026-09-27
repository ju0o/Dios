import os from 'os'
import remoteScript from './remote.py?raw'
import { attachAll, attachMany, listTrash, trashSkill, untrashSkill, type TrashItem } from './keeping'
import { attachSummary, createSkill, exportSkill, importSkill, listHistory, readSkillText, restoreVersion, sameSkillText, saveSkillText, setGuide, type SkillPack, type SkillVersion, type TextResult } from './library'
import { acknowledgeSkill, linkSkill, loadBoard, unlinkSkill, type BoardResult, type SkillBoard } from './model'
import { explainFailure, findPlace, listPlaces, runRemote, stagePack, type Place } from './places'

export interface PlaceBoard {
  place: Place
  ok: boolean
  /** Korean line shown when the place could not be read. */
  problem: string
  board: SkillBoard
}

const EMPTY: SkillBoard = { agents: [], skills: [] }

/** Places the board can show from this computer. */
export function places(): Promise<Place[]> {
  return listPlaces(os.homedir())
}

/** Read one place. Local reads the disk; others run the Python helper there. */
export async function boardFor(placeId: string): Promise<PlaceBoard> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { place: { id: placeId, name: placeId, kind: 'local', target: '' }, ok: false, problem: '그 컴퓨터는 목록에 없어요.', board: EMPTY }
  if (place.kind === 'local') return { place, ok: true, problem: '', board: loadBoard(os.homedir()) }
  try {
    const board = JSON.parse(await runRemote(place, ['board'], remoteScript)) as SkillBoard
    return { place, ok: true, problem: '', board }
  } catch (error) {
    return { place, ok: false, problem: explainFailure(place, error), board: EMPTY }
  }
}

export function linkAt(placeId: string, agentId: string, skillName: string): Promise<BoardResult> {
  return act(placeId, ['link', agentId, skillName], (home) => linkSkill(home, agentId, skillName))
}

export function unlinkAt(placeId: string, agentId: string, skillName: string): Promise<BoardResult> {
  return act(placeId, ['unlink', agentId, skillName], (home) => unlinkSkill(home, agentId, skillName))
}

export function ackAt(placeId: string, skillName: string): Promise<BoardResult> {
  return act(placeId, ['ack', skillName], (home) => acknowledgeSkill(home, skillName))
}

export interface SkillHolder {
  id: string
  name: string
  /** same: text already matches. different: needs a confirm. missing: that computer has no copy. */
  state: 'same' | 'different' | 'missing'
}

export function createAt(placeId: string, name: string, summary: string, steps: string[], agentIds: string[] = []): Promise<BoardResult> {
  return actPacked(placeId, ['create'], (home) => createAndAttach(home, name, summary, steps, agentIds), { name, summary, steps, agentIds })
}

export function readAt(placeId: string, name: string): Promise<TextResult> {
  return actText(placeId, ['read', name], (home) => readSkillText(home, name))
}

export function saveAt(placeId: string, name: string, text: string): Promise<BoardResult> {
  return actPacked(placeId, ['save'], (home) => withBoard(home, saveSkillText(home, name, text)), { name, text })
}

export function guideAt(placeId: string, agentId: string, on: boolean): Promise<BoardResult> {
  return act(placeId, ['guide', agentId, on ? '1' : '0'], (home) => withBoard(home, setGuide(home, agentId, on)))
}

/** Copy one skill folder onto another computer and attach it to the same agents there. */
export async function sendSkill(fromId: string, toId: string, name: string, overwrite: boolean, knownAgents?: string[]): Promise<BoardResult> {
  if (fromId === toId) return { ok: false, message: '같은 컴퓨터예요.', board: EMPTY }
  const from = await findPlace(os.homedir(), fromId)
  const to = await findPlace(os.homedir(), toId)
  if (!from || !to) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', board: EMPTY }
  try {
    const pack = await exportFrom(from, name)
    const skillText = pack?.files.find((file) => file.path === 'SKILL.md')?.text ?? ''
    if (!pack || !skillText) return { ok: false, message: '그 스킬 원본이 없어요.', board: from.kind === 'local' ? loadBoard(os.homedir()) : EMPTY }
    const agentIds = knownAgents ?? (await boardFor(fromId)).board.skills.find((skill) => skill.name === name)?.agents ?? []
    const destText = await readAt(toId, name)
    const same = destText.ok && sameSkillText(destText.text, skillText)
    if (destText.ok && !same && !overwrite) return { ok: false, message: '이미 있어요.', board: EMPTY }
    let written = same ? '글이 같아서 덮지 않았어요.' : ''
    if (!same) {
      const imported = to.kind === 'local'
        ? withBoard(os.homedir(), importSkill(os.homedir(), pack, overwrite || !destText.ok))
        : await importRemote(to, pack, overwrite || !destText.ok)
      if (!imported.ok) return imported
      written = imported.message
    }
    const attached = await attachThere(to, name, agentIds)
    return { ok: true, message: [written, attached.message].filter(Boolean).join(' '), board: EMPTY }
  } catch (error) {
    return { ok: false, message: explainFailure(to, error), board: EMPTY }
  }
}

/** Which other computers already have this skill, and whether their text matches. */
export async function skillHolders(fromId: string, name: string): Promise<{ ok: boolean; message: string; places: SkillHolder[] }> {
  const source = await readAt(fromId, name)
  if (!source.ok) return { ok: false, message: source.message, places: [] }
  const found: SkillHolder[] = []
  const notes: string[] = []
  for (const place of await listPlaces(os.homedir())) {
    if (place.id === fromId) continue
    const dest = await readAt(place.id, name)
    if (!dest.ok) {
      if (dest.message === '그 스킬 글이 없어요.') found.push({ id: place.id, name: place.name, state: 'missing' })
      else notes.push(dest.message)
      continue
    }
    found.push({ id: place.id, name: place.name, state: sameSkillText(dest.text, source.text) ? 'same' : 'different' })
  }
  return { ok: true, message: notes.join(' '), places: found }
}

/** Write this computer's skill text onto the computers the Founder confirmed. */
export async function reflectSkill(fromId: string, name: string, toIds: string[]): Promise<BoardResult> {
  const from = await findPlace(os.homedir(), fromId)
  if (!from) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', board: EMPTY }
  const pack = await exportFrom(from, name)
  const skillText = pack?.files.find((file) => file.path === 'SKILL.md')?.text ?? ''
  if (!pack || !skillText) return { ok: false, message: '그 스킬 원본이 없어요.', board: from.kind === 'local' ? loadBoard(os.homedir()) : EMPTY }
  const notes: string[] = []
  let any = false
  for (const toId of toIds) {
    const to = await findPlace(os.homedir(), toId)
    if (!to || to.id === fromId) continue
    const dest = await readAt(to.id, name)
    if (!dest.ok) {
      notes.push(`${to.name}에는 없어요.`)
      continue
    }
    if (sameSkillText(dest.text, skillText)) {
      notes.push(`${to.name}은 이미 같아요.`)
      continue
    }
    const imported = to.kind === 'local'
      ? withBoard(os.homedir(), importSkill(os.homedir(), pack, true))
      : await importRemote(to, pack, true)
    notes.push(imported.ok ? `${to.name}에 반영했어요.` : imported.message)
    any = any || imported.ok
  }
  const board = from.kind === 'local' ? loadBoard(os.homedir()) : (await boardFor(fromId)).board
  return { ok: any || notes.length > 0, message: notes.join(' ') || '반영할 컴퓨터가 없어요.', board }
}

export async function historyAt(placeId: string, name: string): Promise<{ ok: boolean; message: string; versions: SkillVersion[] }> {
  return actList<{ versions: SkillVersion[] }>(placeId, ['history', name], (home) => listHistory(home, name), { versions: [] })
}

export function restoreAt(placeId: string, name: string, versionId: string): Promise<BoardResult> {
  return act(placeId, ['restore', name, versionId], (home) => withBoard(home, restoreVersion(home, name, versionId)))
}

export function trashAt(placeId: string, name: string): Promise<BoardResult> {
  return act(placeId, ['trash', name], (home) => trashSkill(home, name))
}

export async function trashListAt(placeId: string): Promise<{ ok: boolean; message: string; items: TrashItem[] }> {
  return actList<{ items: TrashItem[] }>(placeId, ['trashlist'], (home) => listTrash(home), { items: [] })
}

export function untrashAt(placeId: string, id: string): Promise<BoardResult> {
  return act(placeId, ['untrash', id], (home) => untrashSkill(home, id))
}

/** One computer's column in the compare view. */
export interface CompareColumn {
  id: string
  name: string
  ok: boolean
  problem: string
}

/** base: the computer being looked at. same/different: text against base. missing: not there. unknown: could not read. */
export type CompareState = 'base' | 'same' | 'different' | 'missing' | 'unknown'

export interface CompareRow {
  name: string
  cells: Record<string, CompareState>
}

/** Read every computer once, in parallel, and compare skill text by fingerprint. */
export async function compareAll(baseId: string): Promise<{ columns: CompareColumn[]; rows: CompareRow[] }> {
  const list = await listPlaces(os.homedir())
  const boards = await Promise.all(list.map((place) => boardFor(place.id)))
  const columns = boards.map((item) => ({ id: item.place.id, name: item.place.name, ok: item.ok, problem: item.problem }))
  const base = boards.find((item) => item.place.id === baseId)
  const names = new Set<string>()
  for (const item of boards) for (const skill of item.board.skills) if (skill.print) names.add(skill.name)
  const rows = [...names].sort().map((name) => {
    const basePrint = base?.board.skills.find((skill) => skill.name === name)?.print ?? ''
    const cells: Record<string, CompareState> = {}
    for (const item of boards) {
      const print = item.board.skills.find((skill) => skill.name === name)?.print ?? ''
      if (!item.ok) cells[item.place.id] = 'unknown'
      else if (item.place.id === baseId) cells[item.place.id] = print ? 'base' : 'missing'
      else if (!print) cells[item.place.id] = 'missing'
      else if (!basePrint) cells[item.place.id] = 'different'
      else cells[item.place.id] = print === basePrint ? 'same' : 'different'
    }
    return { name, cells }
  })
  return { columns, rows }
}

function createAndAttach(home: string, name: string, summary: string, steps: string[], agentIds: string[]): BoardResult {
  const created = createSkill(home, name, summary, steps)
  if (!created.ok) return withBoard(home, created)
  const { linked, skipped } = attachMany(home, name, agentIds)
  const extra = attachSummary(linked, skipped)
  return { ok: true, message: extra ? `스킬을 등록했어요. ${extra}` : created.message, board: loadBoard(home) }
}

/** Attach on the destination in one run (one SSH call for another computer). */
async function attachThere(place: Place, name: string, agentIds: string[]): Promise<BoardResult> {
  if (place.kind === 'local') return attachAll(os.homedir(), name, agentIds)
  return JSON.parse(await runRemote(place, ['attach', name, agentIds.join(',')], remoteScript)) as BoardResult
}

async function importRemote(place: Place, pack: SkillPack, overwrite: boolean): Promise<BoardResult> {
  await stagePack(place, JSON.stringify(pack))
  return JSON.parse(await runRemote(place, ['import', overwrite ? '1' : '0'], remoteScript)) as BoardResult
}

async function exportFrom(place: Place, name: string): Promise<SkillPack | null> {
  if (place.kind === 'local') {
    const exported = exportSkill(os.homedir(), name)
    return exported.ok ? exported.pack : null
  }
  const raw = JSON.parse(await runRemote(place, ['export', name], remoteScript)) as { ok: boolean; pack: SkillPack | null }
  return raw.ok ? raw.pack : null
}

function withBoard(home: string, result: { ok: boolean; message: string }): BoardResult {
  return { ...result, board: loadBoard(home) }
}

async function act(placeId: string, args: string[], local: (home: string) => BoardResult): Promise<BoardResult> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', board: EMPTY }
  if (place.kind === 'local') return local(os.homedir())
  try {
    return JSON.parse(await runRemote(place, args, remoteScript)) as BoardResult
  } catch (error) {
    return { ok: false, message: explainFailure(place, error), board: EMPTY }
  }
}

async function actPacked(placeId: string, args: string[], local: (home: string) => BoardResult, pack: unknown): Promise<BoardResult> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', board: EMPTY }
  if (place.kind === 'local') return local(os.homedir())
  try {
    await stagePack(place, JSON.stringify(pack))
    return JSON.parse(await runRemote(place, args, remoteScript)) as BoardResult
  } catch (error) {
    return { ok: false, message: explainFailure(place, error), board: EMPTY }
  }
}

async function actList<T extends object>(placeId: string, args: string[], local: (home: string) => { ok: boolean; message: string } & T, empty: T): Promise<{ ok: boolean; message: string } & T> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', ...empty }
  if (place.kind === 'local') return local(os.homedir())
  try {
    return JSON.parse(await runRemote(place, args, remoteScript)) as { ok: boolean; message: string } & T
  } catch (error) {
    return { ok: false, message: explainFailure(place, error), ...empty }
  }
}

async function actText(placeId: string, args: string[], local: (home: string) => TextResult): Promise<TextResult> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', text: '' }
  if (place.kind === 'local') return local(os.homedir())
  try {
    return JSON.parse(await runRemote(place, args, remoteScript)) as TextResult
  } catch (error) {
    return { ok: false, message: explainFailure(place, error), text: '' }
  }
}
