import os from 'os'
import path from 'path'
import remoteScript from './remote.py?raw'
import { attachAll, attachMany, listTrash, trashSkill, untrashSkill, type TrashItem } from './keeping'
import { attachSummary, createSkill, exportSkill, importSkill, listHistory, readSkillText, restoreVersion, sameSkillText, saveSkillText, setGuide, type SkillPack, type SkillVersion, type TextResult } from './library'
import { acknowledgeSkill, linkSkill, listRawProjects, loadBoard, unlinkSkill, type BoardResult, type SkillBoard } from './model'
import { presentProjects, type ProjectSkills, type RawProjectSkills } from './project-skills'
import { readLocalUsage, type UsageEntry } from '../agent-monitor/local-logs'
import { driftCount, differentPlaces } from './drift'
import { readSavedTranslationRaw, savedKoreanBlurb, writeSavedTranslationRaw } from './translation-store'
import { textPrint } from './model'
import { explainFailure, findPlace, listPlaces, runRemote, stagePack, type Place } from './places'
import { COPY_FOLDER, REVIEW_FOLDER, copyMessage, reviewMessage, writeReviewBundle, writeSkillCopies, type ExportSkill } from './skill-export'

export interface PlaceBoard {
  place: Place
  ok: boolean
  /** Korean line shown when the place could not be read. */
  problem: string
  board: SkillBoard
}

const EMPTY: SkillBoard = { agents: [], skills: [] }
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/

export interface DesktopPack {
  ok: boolean
  message: string
  /** Folder on the desktop. Empty when nothing was written. Shown only under 원문 보기. */
  folder: string
}

/** Places the board can show from this computer. */
export function places(): Promise<Place[]> {
  return listPlaces(os.homedir())
}

/** Read one place. Local reads the disk; others run the Python helper there. */
export async function boardFor(placeId: string): Promise<PlaceBoard> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { place: { id: placeId, name: placeId, kind: 'local', target: '' }, ok: false, problem: '그 컴퓨터는 목록에 없어요.', board: EMPTY }
  if (place.kind === 'local') return { place, ok: true, problem: '', board: paint(place.id, loadBoard(os.homedir())) }
  try {
    const board = JSON.parse(await runRemote(place, ['board'], remoteScript)) as SkillBoard
    return { place, ok: true, problem: '', board: paint(place.id, board) }
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
    if (!pack || !skillText) return { ok: false, message: '그 스킬 원본이 없어요.', board: from.kind === 'local' ? paint(fromId, loadBoard(os.homedir())) : EMPTY }
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
    const korean = await carryTranslation(fromId, to, name, skillText)
    return { ok: true, message: [written, attached.message, korean].filter(Boolean).join(' '), board: EMPTY }
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
    if (imported.ok) {
      const korean = await carryTranslation(fromId, to, name, skillText)
      if (korean) notes.push(korean)
    }
  }
  const board = from.kind === 'local' ? paint(fromId, loadBoard(os.homedir())) : (await boardFor(fromId)).board
  return { ok: any || notes.length > 0, message: notes.join(' ') || '반영할 컴퓨터가 없어요.', board }
}

/**
 * Send this computer's saved Korean copy of one skill to other computers.
 * Nothing is translated again. A computer whose English text differs is skipped and named.
 */
export async function sendTranslation(fromId: string, name: string, toIds: string[]): Promise<{ ok: boolean; message: string }> {
  const home = os.homedir()
  const saved = readSavedTranslationRaw(home, fromId, name)
  if (!saved) return { ok: false, message: '아직 이 스킬의 번역본이 없어요. 번역본을 먼저 한 번 열어 주세요.' }
  const notes: string[] = []
  let sent = 0
  for (const toId of toIds) {
    if (toId === fromId) continue
    const to = await findPlace(home, toId)
    if (!to) continue
    try {
      const result = await putTranslation(to, name, saved.print, saved.text)
      if (result.ok) {
        sent += 1
        notes.push(`${to.name}에 두었어요.`)
      } else {
        notes.push(`${to.name}: ${result.message}`)
      }
    } catch (error) {
      notes.push(explainFailure(to, error))
    }
  }
  if (!notes.length) return { ok: false, message: '보낼 컴퓨터가 없어요.' }
  return { ok: sent > 0, message: notes.join(' ') }
}

/** A Korean copy that another computer already has for this exact English text. */
export async function fetchTranslation(placeId: string, name: string, source: string): Promise<string | null> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place || place.kind === 'local') return null
  try {
    const raw = JSON.parse(await runRemote(place, ['translation', name], remoteScript)) as { ok: boolean; print: string; text: string }
    if (!raw.ok || raw.print !== textPrint(source) || !raw.text?.trim()) return null
    return raw.text
  } catch {
    return null
  }
}

/** After a skill lands on another computer, its Korean copy follows when this computer has one. */
async function carryTranslation(fromId: string, to: Place, name: string, skillText: string): Promise<string> {
  const saved = readSavedTranslationRaw(os.homedir(), fromId, name)
  if (!saved || saved.print !== textPrint(skillText)) return ''
  try {
    const result = await putTranslation(to, name, saved.print, saved.text)
    return result.ok ? '번역본도 같이 두었어요.' : ''
  } catch {
    return ''
  }
}

async function putTranslation(to: Place, name: string, print: string, text: string): Promise<{ ok: boolean; message: string }> {
  if (to.kind === 'local') {
    const home = os.homedir()
    const current = readSkillText(home, name)
    if (!current.ok) return { ok: false, message: '그 컴퓨터에 그 스킬이 없어요.' }
    if (textPrint(current.text) !== print) return { ok: false, message: '그 컴퓨터의 영어 글이 달라서 번역본을 두지 않았어요.' }
    return writeSavedTranslationRaw(home, 'local', name, print, text)
      ? { ok: true, message: '번역본을 두었어요.' }
      : { ok: false, message: '번역본을 저장하지 못했어요.' }
  }
  await stagePack(to, JSON.stringify({ name, print, text }))
  return JSON.parse(await runRemote(to, ['settranslation'], remoteScript)) as { ok: boolean; message: string }
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

/** Skills Agent Relay attached to each project on this computer. */
export async function projectsAt(placeId: string): Promise<{ ok: boolean; message: string; projects: ProjectSkills[] }> {
  const raw = await actList(placeId, ['projects'], (home) => listRawProjects(home), { projects: [] as RawProjectSkills[] })
  return { ok: raw.ok, message: raw.message, projects: presentProjects(raw.projects) }
}

/** Daily token use one computer's agents wrote to their own logs. */
export async function usageAt(placeId: string): Promise<{ ok: boolean; message: string; entries: UsageEntry[] }> {
  return actList<{ entries: UsageEntry[] }>(placeId, ['usage'], (home) => ({ ok: true, message: '', entries: readLocalUsage(home) }), { entries: [] })
}

/** How many skills on the base computer differ from another computer. */
export async function countDrift(baseId: string): Promise<number> {
  const compared = await compareAll(baseId)
  return driftCount(compared.rows, baseId)
}

/**
 * Overwrite other computers' different copies with this computer's text.
 * A saved Korean copy follows. Skills the other computer does not have are left alone.
 */
export async function alignAll(baseId: string): Promise<{ ok: boolean; message: string; count: number; left: number }> {
  const compared = await compareAll(baseId)
  const jobs = compared.rows
    .map((row) => ({ name: row.name, places: differentPlaces(row.cells, baseId) }))
    .filter((job) => job.places.length)
  if (!jobs.length) return { ok: true, message: '이미 다 같아요.', count: 0, left: 0 }
  let aligned = 0
  let carried = false
  const failed: string[] = []
  for (const job of jobs) {
    const result = await reflectSkill(baseId, job.name, job.places)
    if (result.message.includes('번역본도')) carried = true
    if (result.ok) aligned += 1
    else failed.push(job.name)
  }
  const left = jobs.length - aligned
  const parts = [`다른 글 ${aligned}개를 이 컴퓨터 기준으로 맞췄어요.`]
  if (carried) parts.push('저장해 둔 번역본도 같이 갔어요.')
  if (failed.length) parts.push(`${failed.join(', ')}은 맞추지 못했어요.`)
  return { ok: aligned > 0, message: parts.join(' '), count: aligned, left }
}

/**
 * Copy the skills the Founder picked onto the desktop.
 * They do not need to know where the original folders live.
 */
export async function saveChosenSkills(placeId: string, names: string[], desktop: string): Promise<DesktopPack> {
  const picked = names.filter((name) => SAFE_NAME.test(name))
  if (!picked.length) return { ok: false, message: '저장할 스킬을 먼저 골라 주세요.', folder: '' }
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', folder: '' }
  const packs = []
  let skipped = 0
  for (const name of picked) {
    try {
      const pack = await exportFrom(place, name)
      if (!pack) skipped += 1
      else packs.push(pack)
    } catch {
      skipped += 1
    }
  }
  if (!packs.length) return { ok: false, message: '고른 스킬 글을 읽지 못했어요.', folder: '' }
  const folder = pathJoinDesktop(desktop, COPY_FOLDER)
  try {
    const written = writeSkillCopies(folder, packs)
    if (!written.count) return { ok: false, message: '고른 스킬 글을 읽지 못했어요.', folder: '' }
    return { ok: true, message: copyMessage(written.count, skipped), folder }
  } catch {
    return { ok: false, message: '바탕화면에 저장하지 못했어요. 다시 시도해 주세요.', folder: '' }
  }
}

/**
 * Write one note per linked skill, plus a sheet that tells the Founder what to paste into ChatGPT.
 * DIOS does not call a paid model for this.
 */
export async function saveReviewPack(placeId: string, names: string[], desktop: string): Promise<DesktopPack> {
  const loaded = await boardFor(placeId)
  if (!loaded.ok) return { ok: false, message: loaded.problem || '스킬 목록을 읽지 못했어요.', folder: '' }
  const picked = names.filter((name) => SAFE_NAME.test(name))
  const pool = picked.length ? loaded.board.skills.filter((skill) => picked.includes(skill.name)) : loaded.board.skills
  const linked = pool.filter((skill) => skill.agents.length > 0)
  const unlinked = pool.length - linked.length
  if (!linked.length) {
    const message = picked.length
      ? '고른 스킬은 아직 에이전트에 안 붙었어요. 붙인 다음 다시 눌러 주세요.'
      : '에이전트에 붙은 스킬이 없어요. 붙인 다음 다시 눌러 주세요.'
    return { ok: false, message, folder: '' }
  }
  const skills: ExportSkill[] = []
  for (const skill of linked) {
    const text = await readAt(placeId, skill.name)
    if (!text.ok || !text.text) continue
    skills.push({
      name: skill.name,
      summary: skill.summary,
      korean: skill.koreanSummary ?? '',
      agentNames: skill.agents.map((id) => loaded.board.agents.find((agent) => agent.id === id)?.name || id),
      text: text.text,
    })
  }
  if (!skills.length) return { ok: false, message: '붙은 스킬 글을 읽지 못했어요.', folder: '' }
  const folder = pathJoinDesktop(desktop, REVIEW_FOLDER)
  try {
    writeReviewBundle(folder, skills)
    return { ok: true, message: reviewMessage(skills.length, picked.length ? unlinked : 0), folder }
  } catch {
    return { ok: false, message: '점검 글을 만들지 못했어요. 다시 시도해 주세요.', folder: '' }
  }
}

function pathJoinDesktop(desktop: string, name: string): string {
  const root = path.resolve(desktop)
  const folder = path.resolve(root, name)
  if (folder !== root && !folder.startsWith(`${root}${path.sep}`)) throw new Error('bad desktop')
  return folder
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

/** Attach this computer's saved Korean sentence. A remote board keeps the sentence it sent when this computer has none. */
function paint(placeId: string, board: SkillBoard): SkillBoard {
  if (!board.skills.length) return board
  const home = os.homedir()
  return {
    ...board,
    skills: board.skills.map((skill) => ({
      ...skill,
      koreanSummary: savedKoreanBlurb(home, placeId, skill.name, skill.print) || skill.koreanSummary || '',
    })),
  }
}

function paintResult(placeId: string, result: BoardResult): BoardResult {
  return { ...result, board: paint(placeId, result.board) }
}

async function act(placeId: string, args: string[], local: (home: string) => BoardResult): Promise<BoardResult> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', board: EMPTY }
  if (place.kind === 'local') return paintResult(placeId, local(os.homedir()))
  try {
    return paintResult(placeId, JSON.parse(await runRemote(place, args, remoteScript)) as BoardResult)
  } catch (error) {
    return { ok: false, message: explainFailure(place, error), board: EMPTY }
  }
}

async function actPacked(placeId: string, args: string[], local: (home: string) => BoardResult, pack: unknown): Promise<BoardResult> {
  const place = await findPlace(os.homedir(), placeId)
  if (!place) return { ok: false, message: '그 컴퓨터는 목록에 없어요.', board: EMPTY }
  if (place.kind === 'local') return paintResult(placeId, local(os.homedir()))
  try {
    await stagePack(place, JSON.stringify(pack))
    return paintResult(placeId, JSON.parse(await runRemote(place, args, remoteScript)) as BoardResult)
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
