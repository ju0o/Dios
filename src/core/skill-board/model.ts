import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { guideEnabled } from './library'

/** One tool the Founder can attach a skill to. */
export interface BoardAgent {
  id: string
  name: string
  /** False when that agent's folder or Agent Relay file is missing. */
  ready: boolean
  /** True when this agent's chat file includes the always-on guide. */
  guideOn: boolean
  skillNames: string[]
}

/** One canonical skill and where it is currently attached. */
export interface BoardSkill {
  name: string
  summary: string
  steps: string[]
  /** Unclipped step text opened when a step on the path is clicked. */
  fullSteps: string[]
  /** Fingerprint of the skill text. Equal prints on two computers mean the same text. */
  print: string
  agents: string[]
  changed: boolean
  addedLines: string[]
  removedLines: string[]
}

export interface SkillBoard {
  agents: BoardAgent[]
  skills: BoardSkill[]
}

export interface BoardResult {
  ok: boolean
  message: string
  board: SkillBoard
}

interface WatchEntry {
  hash: string
  body: string
}

interface WatchFile {
  skills: Record<string, WatchEntry>
}

interface FolderAgent {
  id: string
  name: string
  /** Path under the home directory. */
  dir: string
}

const FOLDER_AGENTS: FolderAgent[] = [
  { id: 'claude', name: 'Claude', dir: path.join('.claude', 'skills') },
  { id: 'claude-team', name: 'Claude Team', dir: path.join('.claude-team', 'skills') },
  { id: 'claude-pro', name: 'Claude Pro', dir: path.join('.claude-pro', 'skills') },
  { id: 'codex', name: 'Codex', dir: path.join('.codex', 'skills') },
  { id: 'cursor', name: 'Cursor', dir: path.join('.cursor', 'skills') },
  { id: 'grok', name: 'Grok', dir: path.join('.grok', 'skills') },
  { id: 'cline', name: 'Cline', dir: path.join('.cline', 'skills') },
  { id: 'commandcode', name: 'CommandCode', dir: path.join('.commandcode', 'skills') },
  { id: 'opencode', name: 'OpenCode', dir: path.join('.config', 'opencode', 'skills') },
]

const RELAY_ID = 'agent-relay'
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/

/**
 * Read the skill board for one home directory.
 * Canonical skills live in `.agents/skills`. Tool folders hold links.
 */
export function loadBoard(home: string): SkillBoard {
  const canonical = canonicalDir(home)
  const watch = readWatch(watchPath(home))
  let watchDirty = false
  const names = new Set<string>(listSkillDirs(canonical))
  const agentSkills = new Map<string, string[]>()

  const agents: BoardAgent[] = FOLDER_AGENTS.map((agent) => {
    const dir = path.join(home, agent.dir)
    const ready = fs.existsSync(path.dirname(dir)) || fs.existsSync(dir)
    const skillNames = ready ? listSkillDirs(dir) : []
    skillNames.forEach((name) => names.add(name))
    agentSkills.set(agent.id, skillNames)
    return { id: agent.id, name: agent.name, ready, guideOn: guideEnabled(home, agent.id), skillNames }
  })

  const relay = readRelaySkills(portfolioPath(home))
  agents.push({
    id: RELAY_ID,
    name: 'Agent Relay',
    ready: relay.ready,
    guideOn: false,
    skillNames: relay.names,
  })
  relay.names.forEach((name) => names.add(name))
  agentSkills.set(RELAY_ID, relay.names)

  const skills: BoardSkill[] = [...names].sort().map((name) => {
    const file = path.join(canonical, name, 'SKILL.md')
    const raw = readSkillFile(file)
    const story = skillStory(raw)
    const currentHash = raw ? hashText(raw) : ''
    const seen = watch.skills[name]
    const changed = Boolean(seen && currentHash && seen.hash !== currentHash)
    const diff = changed && seen ? lineDiff(seen.body, raw) : { added: [], removed: [] }
    if (raw && !seen) {
      watch.skills[name] = { hash: currentHash, body: raw.slice(0, 20000) }
      watchDirty = true
    }
    const attached = [...agentSkills.entries()].filter(([, list]) => list.includes(name)).map(([id]) => id)
    return {
      name,
      summary: story.summary,
      steps: story.steps,
      fullSteps: story.fullSteps,
      print: textPrint(raw),
      agents: attached,
      changed,
      addedLines: diff.added,
      removedLines: diff.removed,
    }
  })

  if (watchDirty) writeWatch(watchPath(home), watch)
  return { agents, skills }
}

/**
 * Attach a canonical skill to one agent.
 * Folder agents get a link. Agent Relay adds the name on every work lane.
 * The skill text itself is never copied or deleted.
 */
export function linkSkill(home: string, agentId: string, skillName: string): BoardResult {
  const checked = checkName(skillName)
  if (!checked.ok) return { ok: false, message: checked.message, board: loadBoard(home) }
  const src = path.join(canonicalDir(home), skillName)
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
    return { ok: false, message: '그 스킬 원본이 없어요.', board: loadBoard(home) }
  }
  if (agentId === RELAY_ID) return finishRelay(home, skillName, true)
  const agent = FOLDER_AGENTS.find((item) => item.id === agentId)
  if (!agent) return { ok: false, message: '그 에이전트는 없어요.', board: loadBoard(home) }

  const destDir = path.join(home, agent.dir)
  const dest = path.join(destDir, skillName)
  fs.mkdirSync(destDir, { recursive: true })
  const existing = linkStat(dest)
  if (existing?.isSymbolicLink()) {
    const same = sameTarget(dest, src)
    return {
      ok: same,
      message: same ? `${agent.name}에 이미 붙어 있어요.` : '다른 곳을 가리키고 있어서 바꾸지 않았어요.',
      board: loadBoard(home),
    }
  }
  if (existing) {
    return { ok: false, message: '이 에이전트 안에 스킬 복사본이 있어서 링크만 달지는 않았어요.', board: loadBoard(home) }
  }
  fs.symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : undefined)
  return { ok: true, message: `${agent.name}에 붙였어요.`, board: loadBoard(home) }
}

/**
 * Remove a skill from one agent.
 * A link is removed. A real folder is left in place so the skill text is not deleted.
 */
export function unlinkSkill(home: string, agentId: string, skillName: string): BoardResult {
  const checked = checkName(skillName)
  if (!checked.ok) return { ok: false, message: checked.message, board: loadBoard(home) }
  if (agentId === RELAY_ID) return finishRelay(home, skillName, false)
  const agent = FOLDER_AGENTS.find((item) => item.id === agentId)
  if (!agent) return { ok: false, message: '그 에이전트는 없어요.', board: loadBoard(home) }
  const dest = path.join(home, agent.dir, skillName)
  const existing = linkStat(dest)
  if (!existing) return { ok: true, message: `${agent.name}에는 이미 없어요.`, board: loadBoard(home) }
  if (!existing.isSymbolicLink()) {
    return { ok: false, message: '원본 폴더라서 빼지 않았어요. 스킬 글은 그대로예요.', board: loadBoard(home) }
  }
  fs.unlinkSync(dest)
  return { ok: true, message: `${agent.name}에서 뺐어요. 스킬 글은 그대로예요.`, board: loadBoard(home) }
}

/** Mark the current skill text as the one the Founder has seen. */
export function acknowledgeSkill(home: string, skillName: string): BoardResult {
  const checked = checkName(skillName)
  if (!checked.ok) return { ok: false, message: checked.message, board: loadBoard(home) }
  const file = path.join(canonicalDir(home), skillName, 'SKILL.md')
  const raw = readSkillFile(file)
  if (!raw) return { ok: false, message: '그 스킬 글이 없어요.', board: loadBoard(home) }
  const watch = readWatch(watchPath(home))
  watch.skills[skillName] = { hash: hashText(raw), body: raw.slice(0, 20000) }
  writeWatch(watchPath(home), watch)
  return { ok: true, message: '바뀐 글을 확인했어요.', board: loadBoard(home) }
}

/**
 * Add or remove a skill name on every Agent Relay lane.
 * Other portfolio fields stay as they are.
 */
export function applyRelay(portfolio: { projects?: Array<{ skills?: Record<string, unknown> }> }, skillName: string, attached: boolean): number {
  let touched = 0
  for (const project of portfolio.projects ?? []) {
    const skills = project.skills
    if (!skills || typeof skills !== 'object') continue
    for (const role of Object.keys(skills)) {
      const list = skills[role]
      if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) continue
      const has = list.includes(skillName)
      if (attached && !has) {
        list.push(skillName)
        touched += 1
      }
      if (!attached && has) {
        skills[role] = list.filter((item) => item !== skillName)
        touched += 1
      }
    }
  }
  return touched
}

/** Pull a short Korean summary and up to five steps out of a SKILL.md file. */
export function skillStory(raw: string): { summary: string; steps: string[]; fullSteps: string[] } {
  const { description, body } = splitFrontMatter(raw)
  const summary = koreanSentence(description)
  const full = koreanLines(body, 180).slice(0, 5)
  const fullSteps = full.length ? full : ['이 스킬의 순서는 글을 열면 보여요.']
  return { summary, steps: fullSteps.map((step) => clip(step, 42)), fullSteps }
}

/** Fingerprint that ignores Windows line endings and outer blank lines. Matches remote.py text_print. */
export function textPrint(text: string): string {
  return text ? hashText(text.replace(/\r\n/g, '\n').trim()) : ''
}

/** First-seen text is the baseline. Later edits show up as added and removed lines. */
export function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const oldLines = new Set(before.split('\n').map((line) => line.trim()).filter(Boolean))
  const newLines = after.split('\n').map((line) => line.trim()).filter(Boolean)
  const newSet = new Set(newLines)
  return {
    added: newLines.filter((line) => !oldLines.has(line)).slice(0, 6),
    removed: [...oldLines].filter((line) => !newSet.has(line)).slice(0, 6),
  }
}

function finishRelay(home: string, skillName: string, attached: boolean): BoardResult {
  const file = portfolioPath(home)
  if (!fs.existsSync(file)) {
    return { ok: false, message: 'Agent Relay 설정이 이 컴퓨터에 없어요.', board: loadBoard(home) }
  }
  let portfolio: { projects?: Array<{ skills?: Record<string, unknown> }> }
  try {
    portfolio = JSON.parse(fs.readFileSync(file, 'utf8')) as { projects?: Array<{ skills?: Record<string, unknown> }> }
  } catch {
    return { ok: false, message: 'Agent Relay 설정을 읽지 못했어요.', board: loadBoard(home) }
  }
  const touched = applyRelay(portfolio, skillName, attached)
  if (touched > 0) {
    const tmp = `${file}.dios-tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(portfolio, null, 2)}\n`)
    fs.renameSync(tmp, file)
  }
  const message = attached
    ? (touched ? `Agent Relay 작업 ${touched}곳에 붙였어요.` : 'Agent Relay에 이미 붙어 있어요.')
    : (touched ? `Agent Relay 작업 ${touched}곳에서 뺐어요. 스킬 글은 그대로예요.` : 'Agent Relay에는 이미 없어요.')
  return { ok: true, message, board: loadBoard(home) }
}

function checkName(skillName: string): { ok: true } | { ok: false; message: string } {
  if (!SAFE_NAME.test(skillName)) return { ok: false, message: '스킬 이름이 이상해요.' }
  return { ok: true }
}

function canonicalDir(home: string): string {
  return path.join(home, '.agents', 'skills')
}

function watchPath(home: string): string {
  return path.join(home, '.local', 'share', 'dios', 'skill-watch.json')
}

function portfolioPath(home: string): string {
  return path.join(home, '.local', 'share', 'AgentRelay', 'night-runtime', 'config', 'portfolio.json')
}

function listSkillDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const names: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!SAFE_NAME.test(entry.name)) continue
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))) names.push(entry.name)
  }
  return names.sort()
}

function readSkillFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readRelaySkills(file: string): { ready: boolean; names: string[] } {
  if (!fs.existsSync(file)) return { ready: false, names: [] }
  try {
    const portfolio = JSON.parse(fs.readFileSync(file, 'utf8')) as { projects?: Array<{ skills?: Record<string, unknown> }> }
    const names = new Set<string>()
    for (const project of portfolio.projects ?? []) {
      const skills = project.skills
      if (!skills) continue
      for (const list of Object.values(skills)) {
        if (!Array.isArray(list)) continue
        for (const item of list) if (typeof item === 'string' && SAFE_NAME.test(item)) names.add(item)
      }
    }
    return { ready: true, names: [...names].sort() }
  } catch {
    return { ready: false, names: [] }
  }
}

function readWatch(file: string): WatchFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as WatchFile
    if (parsed && typeof parsed.skills === 'object') return parsed
  } catch {
    // A missing watch file means this is the first look. That look becomes the baseline.
  }
  return { skills: {} }
}

function writeWatch(file: string, watch: WatchFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(watch, null, 2)}\n`)
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function linkStat(file: string): fs.Stats | null {
  try {
    return fs.lstatSync(file)
  } catch {
    return null
  }
}

function sameTarget(link: string, src: string): boolean {
  try {
    return fs.realpathSync(link) === fs.realpathSync(src)
  } catch {
    return false
  }
}

function splitFrontMatter(raw: string): { description: string; body: string } {
  if (!raw.startsWith('---')) return { description: '', body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { description: '', body: raw }
  const front = raw.slice(3, end)
  const match = front.match(/^description:\s*(.+)$/m)
  const description = match ? match[1].trim().replace(/^["']|["']$/g, '') : ''
  return { description, body: raw.slice(end + 4) }
}

/** First sentence that is mostly Korean. English descriptions give an empty summary. */
function koreanSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  for (const piece of flat.split(/(?<=[.!?。])\s+/)) {
    if (hangulRatio(piece) >= 0.35) return clip(piece, 90)
  }
  return ''
}

function koreanLines(body: string, limit = 42): string[] {
  const lines: string[] = []
  let fence = false
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('```')) {
      fence = !fence
      continue
    }
    if (fence) continue
    const item = line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').replace(/`[^`]*`/g, '').trim()
    if (hangulRatio(item) < 0.35) continue
    const at = item.search(/[가-힣]/)
    const visible = clip(item.slice(at), limit)
    if (visible.length < 4) continue
    lines.push(visible)
  }
  return [...new Set(lines)]
}

function hangulRatio(text: string): number {
  const chars = [...text.replace(/\s/g, '')]
  if (!chars.length) return 0
  const korean = chars.filter((char) => /[가-힣]/.test(char)).length
  return korean / chars.length
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}
