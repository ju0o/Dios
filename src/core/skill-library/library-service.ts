import fs from 'fs'
import os from 'os'
import path from 'path'
import { attachMany } from '../skill-board/keeping'
import { attachSummary, importSkill, type SkillFile } from '../skill-board/library'
import { loadBoard } from '../skill-board/model'
import { boardFor, places, sendSkill } from '../skill-board/board-service'
import { LIBRARY_AGENTS, canonicalDir, frontmatter, readLibrary, rememberAdded, type LibrarySkill } from './catalog'
import { proseHangulRatio } from '../skill-board/markdown-text'
import { translateSummary } from '../skill-board/translate'
import { writeBlurb } from '../skill-board/translation-store'
import { candidateFromFiles, fetchSkillCandidates, packOf, type FetchOutcome, type SkillCandidate } from './fetch-skill'

export interface LibraryListing {
  skills: LibrarySkill[]
  /** Agents whose folder exists on this computer, in board order. */
  readyAgents: Array<{ id: string; name: string }>
}

export interface LibraryResult {
  ok: boolean
  message: string
  listing: LibraryListing
}

/** A skill another computer has and this one does not. */
export interface RemoteSkill {
  placeId: string
  placeName: string
  name: string
  summary: string
}

const MAX_FILES = 40
const MAX_FILE = 256_000
const FOUNDER = '대표님이 추가'

/** Everything the library screen shows. `extraRoots` come from 프로젝트 자료 연결. */
export function listLibrary(extraRoots: string[] = []): LibraryListing {
  const home = os.homedir()
  const board = loadBoard(home)
  const readyAgents = LIBRARY_AGENTS.filter((agent) => board.agents.find((item) => item.id === agent.id)?.ready).map((agent) => ({ id: agent.id, name: agent.name }))
  return { skills: readLibrary(home, extraRoots), readyAgents }
}

/**
 * Make one Korean sentence for a skill card.
 * Only the description is translated, and a repeated or broken sentence is not saved.
 */
export async function translateCard(name: string, extraRoots: string[] = []): Promise<{ ok: boolean; message: string; korean: string }> {
  const home = os.homedir()
  const skill = readLibrary(home, extraRoots).find((item) => item.name === name)
  if (!skill) return { ok: false, message: '그 스킬이 없어요.', korean: '' }
  const folder = fs.existsSync(path.join(canonicalDir(home), name, 'SKILL.md'))
    ? path.join(canonicalDir(home), name)
    : skill.homes.find((item) => !item.link)?.path || skill.homes[0]?.path || ''
  const file = folder ? path.join(folder, 'SKILL.md') : ''
  const raw = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const english = (frontmatter(raw).description || skill.summary).replace(/\s+/g, ' ').trim()
  if (!english) return { ok: false, message: '번역할 설명이 없어요.', korean: '' }
  if (proseHangulRatio(english) >= 0.45) {
    const korean = english.length > 140 ? `${english.slice(0, 140).trim()}…` : english
    writeBlurb(home, name, skill.print, korean)
    return { ok: true, message: '이미 한글이에요.', korean }
  }
  const translated = await translateSummary(english)
  if (!translated.ok || !translated.text) return { ok: false, message: translated.message, korean: '' }
  writeBlurb(home, name, skill.print, translated.text)
  return { ok: true, message: translated.message, korean: translated.text }
}

/** Look behind an address without writing anything. */
export function previewSkill(address: string): Promise<FetchOutcome> {
  return fetchSkillCandidates(address)
}

/**
 * Write one downloaded skill into the shared folder, remember where it came from, and attach it.
 * With no agent list it goes on every agent that is ready, so it works right away.
 */
export function addCandidate(candidate: SkillCandidate, agentIds: string[] | null, extraRoots: string[] = []): LibraryResult {
  const home = os.homedir()
  const written = importSkill(home, packOf(candidate), false)
  if (!written.ok) {
    const message = written.message === '이미 있어요.' ? '같은 이름의 스킬이 이미 있어요. 먼저 그 스킬을 지우거나 이름을 바꿔 주세요.' : written.message
    return { ok: false, message, listing: listLibrary(extraRoots) }
  }
  rememberAdded(home, candidate.name, FOUNDER, candidate.source)
  const attached = attachTo(home, candidate.name, agentIds)
  return { ok: true, message: `${candidate.name} 스킬을 받았어요. ${attached}`.trim(), listing: listLibrary(extraRoots) }
}

/** Copy a skill folder the Founder picked on this computer into the shared folder. */
export function addFolder(folder: string, agentIds: string[] | null, extraRoots: string[] = []): LibraryResult {
  const files = readFolder(folder)
  if (!files) return { ok: false, message: '그 폴더 안에 SKILL.md가 없어요. 스킬 폴더를 골라 주세요.', listing: listLibrary(extraRoots) }
  const candidate = candidateFromFiles(path.basename(folder).toLowerCase(), files, folder)
  if (!candidate) return { ok: false, message: '스킬 이름을 읽지 못했어요. SKILL.md 맨 위 name: 줄은 영문 소문자와 줄표여야 해요.', listing: listLibrary(extraRoots) }
  return addCandidate({ ...candidate, source: folder }, agentIds, extraRoots)
}

/** Attach a skill that is already in the shared folder to more agents. */
export function attachSkill(name: string, agentIds: string[], extraRoots: string[] = []): LibraryResult {
  const home = os.homedir()
  if (!fs.existsSync(path.join(home, '.agents', 'skills', name, 'SKILL.md'))) {
    return { ok: false, message: '이 스킬은 공용 폴더에 없어서 붙일 수 없어요. 먼저 공용 폴더에 넣어 주세요.', listing: listLibrary(extraRoots) }
  }
  return { ok: true, message: attachTo(home, name, agentIds) || '바뀐 것이 없어요.', listing: listLibrary(extraRoots) }
}

/** A skill that lives only outside the shared folder, and is not one Cursor ships itself. */
export function isGatherable(skill: LibrarySkill): boolean {
  return !skill.canonical && skill.homes.some((home) => home.id !== 'cursor-builtin' && !home.link)
}

/** The line shown after gathering every loose skill at once. */
export function gatherMessage(done: number, builtinLeft: number, failed: number): string {
  const head = done
    ? `${done}개를 공용 폴더에 넣고, 준비된 에이전트에 붙였어요. 원래 있던 폴더는 그대로 있어요.`
    : '모을 수 있는 스킬이 없어요.'
  const builtin = builtinLeft ? ` Cursor가 기본으로 넣어 둔 ${builtinLeft}개는 그대로 뒀어요.` : ''
  const skipped = failed ? ` ${failed}개는 이름을 읽지 못해 건너뛰었어요.` : ''
  return `${head}${builtin}${skipped}`.trim()
}

/**
 * Copy a skill that lives only in an agent's or a tool's folder into the shared folder,
 * so it can be attached to other agents and sent to other computers.
 */
export function adoptSkill(name: string, from: string, agentIds: string[] | null, extraRoots: string[] = []): LibraryResult {
  const copied = copyIntoShared(os.homedir(), name, from, agentIds)
  if (!copied.ok) return { ok: false, message: copied.message, listing: listLibrary(extraRoots) }
  return { ok: true, message: `공용 폴더에 넣었어요. ${copied.message}`.trim(), listing: listLibrary(extraRoots) }
}

/**
 * Copy every skill that lives in only one folder into the shared folder and attach it.
 * Cursor's own built-in skills stay where they are.
 */
/** Gather loose skills inside one home. Tests pass a temporary home; the app uses gatherLoose. */
export function gatherLooseIn(home: string, extraRoots: string[] = []): { ok: boolean; message: string; done: number } {
  const before = readLibrary(home, extraRoots)
  let done = 0
  let failed = 0
  for (const skill of before.filter(isGatherable)) {
    const from = skill.homes.find((item) => item.id !== 'cursor-builtin' && !item.link)
    if (!from) continue
    const copied = copyIntoShared(home, skill.name, from.path, null)
    if (copied.ok) done += 1
    else failed += 1
  }
  const builtinLeft = before.filter((skill) => !skill.canonical && skill.homes.length > 0 && skill.homes.every((item) => item.id === 'cursor-builtin')).length
  return { ok: failed === 0, message: gatherMessage(done, builtinLeft, failed), done }
}

export function gatherLoose(extraRoots: string[] = []): LibraryResult {
  const outcome = gatherLooseIn(os.homedir(), extraRoots)
  return { ok: outcome.ok, message: outcome.message, listing: listLibrary(extraRoots) }
}

function copyIntoShared(home: string, name: string, from: string, agentIds: string[] | null): { ok: boolean; message: string } {
  const files = readFolder(from)
  if (!files) return { ok: false, message: '그 폴더의 스킬 글을 읽지 못했어요.' }
  const candidate = candidateFromFiles(name, files, from)
  if (!candidate || candidate.name !== name) return { ok: false, message: '스킬 이름이 폴더 이름과 달라요.' }
  const written = importSkill(home, packOf(candidate), false)
  if (!written.ok) return written
  rememberAdded(home, name, `${path.basename(path.dirname(from))} 폴더에서 옮김`, from)
  return { ok: true, message: attachTo(home, name, agentIds) }
}

/** Skills other computers have that this one is missing. Computers that are off are skipped. */
export async function remoteSkills(): Promise<{ ok: boolean; message: string; skills: RemoteSkill[] }> {
  const here = new Set(loadBoard(os.homedir()).skills.map((skill) => skill.name))
  const list = (await places()).filter((place) => place.kind !== 'local')
  if (!list.length) return { ok: true, message: '연결된 다른 컴퓨터가 없어요.', skills: [] }
  const boards = await Promise.all(list.map((place) => boardFor(place.id)))
  const skills: RemoteSkill[] = []
  const problems: string[] = []
  for (const item of boards) {
    if (!item.ok) {
      problems.push(item.place.name.replace(/ \(SSH\)$/, ''))
      continue
    }
    for (const skill of item.board.skills) {
      if (here.has(skill.name) || !skill.print) continue
      skills.push({ placeId: item.place.id, placeName: item.place.name.replace(/ \(SSH\)$/, ''), name: skill.name, summary: skill.koreanSummary || skill.summary })
    }
  }
  skills.sort((left, right) => left.name.localeCompare(right.name))
  const message = problems.length ? `${problems.join(', ')} 컴퓨터는 지금 못 읽었어요. 꺼져 있으면 그래요.` : ''
  return { ok: true, message, skills }
}

/** Bring one skill from another computer here and attach it to the same agents. */
export async function takeFromPlace(placeId: string, name: string, extraRoots: string[] = []): Promise<LibraryResult> {
  const result = await sendSkill(placeId, 'local', name, false)
  if (result.ok) {
    const place = (await places()).find((item) => item.id === placeId)
    rememberAdded(os.homedir(), name, `${place?.name.replace(/ \(SSH\)$/, '') ?? placeId} 컴퓨터에서 가져옴`, placeId)
  }
  return { ok: result.ok, message: result.ok ? `${name} 스킬을 가져왔어요. ${result.message}`.trim() : result.message, listing: listLibrary(extraRoots) }
}

function attachTo(home: string, name: string, agentIds: string[] | null): string {
  const ids = agentIds ?? loadBoard(home).agents.filter((agent) => agent.ready && agent.id !== 'agent-relay').map((agent) => agent.id)
  if (!ids.length) return ''
  const { linked, skipped } = attachMany(home, name, ids)
  return attachSummary(linked, skipped)
}

/** Text files of one skill folder, relative paths, or null when SKILL.md is missing. */
function readFolder(folder: string): SkillFile[] | null {
  if (!folder || !fs.existsSync(path.join(folder, 'SKILL.md'))) return null
  const files: SkillFile[] = []
  const walk = (current: string, prefix: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full, rel)
        continue
      }
      if (!entry.isFile()) continue
      try {
        if (fs.statSync(full).size > MAX_FILE) continue
        const text = fs.readFileSync(full, 'utf8')
        if (text.includes('\u0000')) continue
        files.push({ path: rel, text })
      } catch {
        // Unreadable files are left out; SKILL.md itself was checked above.
      }
    }
  }
  walk(folder, '')
  return files.some((file) => file.path === 'SKILL.md') ? files : null
}
