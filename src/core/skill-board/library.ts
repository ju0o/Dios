import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/** One text file inside a skill folder. Paths stay relative to that folder. */
export interface SkillFile {
  path: string
  text: string
}

/** A skill folder, ready to write on another computer. */
export interface SkillPack {
  name: string
  files: SkillFile[]
}

export interface TextResult {
  ok: boolean
  message: string
  text: string
}

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/
const MARKER = '<!-- founder-gate-relay-always -->'
const MAX_FILE = 256_000
const MAX_FILES = 40

interface GuideFile {
  id: string
  parts: string[]
  /** This file belongs to the guide. Turning it off removes the file when nothing else is in it. */
  dedicated: boolean
  cursor: boolean
}

const GUIDE_FILES: GuideFile[] = [
  { id: 'claude', parts: ['.claude', 'CLAUDE.md'], dedicated: false, cursor: false },
  { id: 'claude-team', parts: ['.claude-team', 'CLAUDE.md'], dedicated: false, cursor: false },
  { id: 'claude-pro', parts: ['.claude-pro', 'CLAUDE.md'], dedicated: false, cursor: false },
  { id: 'codex', parts: ['.codex', 'AGENTS.md'], dedicated: false, cursor: false },
  { id: 'cursor', parts: ['.cursor', 'rules', 'founder-gate-relay.mdc'], dedicated: true, cursor: true },
  { id: 'grok', parts: ['.grok', 'rules', 'founder-gate.md'], dedicated: true, cursor: false },
  { id: 'cline', parts: ['.cline', 'rules', 'founder-gate.md'], dedicated: true, cursor: false },
  { id: 'commandcode', parts: ['.commandcode', 'AGENTS.md'], dedicated: false, cursor: false },
  { id: 'opencode', parts: ['.config', 'opencode', 'AGENTS.md'], dedicated: false, cursor: false },
]

const BUNDLED_GUIDE = `${MARKER}
# Founder Gate

When the next step needs the Founder (login, upload, click, approve, open a program, paste a command, pay, publish, delete, merge, push) and it is not a report back to you, send it with founder-gate-relay before asking in chat.

- On MainPC the script writes the desktop folders directly, then you continue after the report. On ASUS the same script sends them over SSH.
- Web (browser): \`new --kind web --created-by "<your name>"\` → \`Aside\\아직_해야할_일\`.
- Not web (the Founder opens a program or pastes a command): \`new --kind cli\` → \`Founder\\아직_해야할_일\`.
- The top of the file names you as the agent who receives the report. Relay the printed \`대표님께:\` line. No folder paths in that line.
- Report is enough: \`resolve <gateId> --note "<결과>"\` → \`보관\\<날짜>\\<프로젝트>\\<작업>\`.
- Same task but thin: \`retry <gateId> --note "<부족한 점>" --step "<다시 할 일>"\`. The old file goes to \`보관\\...\\실패\` and a new to-do is sent in the same moment.
- You do this when the report reaches you. Do not wait for a background poll.
- Title is the first sentence of the question, in Korean. Never title a gate "사람 확인".
`

/** One line the Founder sees after attaching a new or copied skill. */
export function attachSummary(linked: string[], skipped: string[]): string {
  const parts: string[] = []
  if (linked.length) parts.push(`${linked.join(', ')}에 붙였어요.`)
  if (skipped.length) parts.push(`빼 둔 곳: ${skipped.join(', ')}.`)
  return parts.join(' ')
}

/** Compare skill text without caring about a trailing newline or Windows line endings. */
export function sameSkillText(left: string, right: string): boolean {
  return left.replace(/\r\n/g, '\n').trim() === right.replace(/\r\n/g, '\n').trim()
}
export function guideEnabled(home: string, agentId: string): boolean {
  const guide = GUIDE_FILES.find((item) => item.id === agentId)
  if (!guide) return false
  return readFile(path.join(home, ...guide.parts)).includes(MARKER)
}

/**
 * Create a canonical skill from a name, one sentence, and ordered steps.
 * Does not attach it. The board attaches with the existing link action.
 */
export function createSkill(home: string, name: string, summary: string, steps: string[]): { ok: boolean; message: string } {
  if (!SAFE_NAME.test(name)) return { ok: false, message: '이름은 영문 소문자와 줄표로 적어 주세요. 예: weekly-report' }
  const sentence = summary.replace(/\s+/g, ' ').trim()
  if (!sentence) return { ok: false, message: '하는 일을 한 문장으로 적어 주세요.' }
  const lines = steps.map((step) => step.trim()).filter(Boolean)
  if (!lines.length) return { ok: false, message: '순서를 한 줄씩 적어 주세요.' }
  const dir = path.join(canonical(home), name)
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return { ok: false, message: '이미 있는 스킬이에요.' }
  const text = renderSkill(name, sentence, lines)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text)
  remember(home, name, text)
  return { ok: true, message: '스킬을 등록했어요. 에이전트 카드에서 붙이면 돼요.' }
}

/** Current SKILL.md text, for the editor. */
export function readSkillText(home: string, name: string): TextResult {
  if (!SAFE_NAME.test(name)) return { ok: false, message: '스킬 이름이 이상해요.', text: '' }
  const text = readFile(path.join(canonical(home), name, 'SKILL.md'))
  if (!text) return { ok: false, message: '그 스킬 글이 없어요.', text: '' }
  return { ok: true, message: '', text }
}

/** Save SKILL.md and treat the saved text as the new baseline. */
export function saveSkillText(home: string, name: string, text: string): { ok: boolean; message: string } {
  if (!SAFE_NAME.test(name)) return { ok: false, message: '스킬 이름이 이상해요.' }
  const file = path.join(canonical(home), name, 'SKILL.md')
  if (!fs.existsSync(file)) return { ok: false, message: '그 스킬 글이 없어요.' }
  const next = text.endsWith('\n') ? text : `${text}\n`
  if (!next.includes('name:')) return { ok: false, message: '스킬 이름 줄이 있어야 저장돼요.' }
  const previous = readFile(file)
  keepHistory(home, name, previous)
  fs.writeFileSync(file, next)
  remember(home, name, next)
  const added = countNewLines(previous, next)
  const removed = countNewLines(next, previous)
  return { ok: true, message: `저장했어요. ${added}줄이 들어오고 ${removed}줄이 빠졌어요.` }
}

/** Read a skill folder into memory so it can be written on another computer. */
export function exportSkill(home: string, name: string): { ok: boolean; message: string; pack: SkillPack | null } {
  if (!SAFE_NAME.test(name)) return { ok: false, message: '스킬 이름이 이상해요.', pack: null }
  const root = path.join(canonical(home), name)
  if (!fs.existsSync(path.join(root, 'SKILL.md'))) return { ok: false, message: '그 스킬 원본이 없어요.', pack: null }
  const files: SkillFile[] = []
  collect(root, root, files)
  if (!files.some((file) => file.path === 'SKILL.md')) return { ok: false, message: '그 스킬 글을 읽지 못했어요.', pack: null }
  return { ok: true, message: '', pack: { name, files } }
}

/**
 * Write a skill folder from another computer.
 * Refuses to replace an existing skill unless overwrite is true.
 */
export function importSkill(home: string, pack: SkillPack, overwrite: boolean): { ok: boolean; message: string } {
  if (!pack || !SAFE_NAME.test(pack.name)) return { ok: false, message: '스킬 이름이 이상해요.' }
  const skillFile = pack.files?.find((file) => file.path === 'SKILL.md')
  if (!skillFile?.text) return { ok: false, message: '보낼 스킬 글이 없어요.' }
  const root = path.join(canonical(home), pack.name)
  if (fs.existsSync(path.join(root, 'SKILL.md')) && !overwrite) return { ok: false, message: '이미 있어요.' }
  keepHistory(home, pack.name, readFile(path.join(root, 'SKILL.md')))
  for (const file of pack.files) {
    const dest = safeDest(root, file.path)
    if (!dest) return { ok: false, message: '스킬 안에 이상한 경로가 있어요.' }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, file.text)
  }
  remember(home, pack.name, skillFile.text.endsWith('\n') ? skillFile.text : `${skillFile.text}\n`)
  return { ok: true, message: overwrite ? '그 컴퓨터의 스킬 글을 바꿨어요.' : '그 컴퓨터에 스킬을 보냈어요.' }
}

/** Turn the always-on chat guide on or off for one agent. Other text in that file stays. */
export function setGuide(home: string, agentId: string, on: boolean): { ok: boolean; message: string } {
  const guide = GUIDE_FILES.find((item) => item.id === agentId)
  if (!guide) return { ok: false, message: '그 에이전트에는 매 대화 안내가 없어요.' }
  const file = path.join(home, ...guide.parts)
  const current = readFile(file)
  const enabled = current.includes(MARKER)
  if (on && enabled) return { ok: true, message: '이미 켜져 있어요.' }
  if (!on && !enabled) return { ok: true, message: '이미 꺼져 있어요.' }
  if (!on) {
    const kept = current.slice(0, current.indexOf(MARKER)).replace(/\s+$/, '')
    if (!kept || (guide.dedicated && isOnlyCursorFront(kept))) {
      fs.rmSync(file, { force: true })
    } else {
      fs.writeFileSync(file, `${kept}\n`)
    }
    return { ok: true, message: '매 대화 안내를 껐어요.' }
  }
  const block = guide.cursor ? cursorWrap(guideText(home)) : guideText(home)
  const base = enabled ? current.slice(0, current.indexOf(MARKER)).replace(/\s+$/, '') : current.replace(/\s+$/, '')
  const next = base ? `${base}\n\n${block}` : block
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`)
  return { ok: true, message: '매 대화 안내를 켰어요.' }
}

/** One kept copy of an older SKILL.md. `when` is milliseconds since 1970. */
export interface SkillVersion {
  id: string
  when: number
  /** How many lines differ from the current text. */
  diff: number
}

/** Older texts of one skill, newest first. */
export function listHistory(home: string, name: string): { ok: boolean; message: string; versions: SkillVersion[] } {
  if (!SAFE_NAME.test(name)) return { ok: false, message: '스킬 이름이 이상해요.', versions: [] }
  const current = readFile(path.join(canonical(home), name, 'SKILL.md'))
  const dir = historyDir(home, name)
  const ids = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((file) => /^\d+\.md$/.test(file)).map((file) => file.slice(0, -3)).sort().reverse()
    : []
  const versions = ids.map((id) => ({ id, when: Number(id), diff: changedLines(readFile(path.join(dir, `${id}.md`)), current) }))
  return { ok: true, message: versions.length ? '' : '아직 보관된 이전 글이 없어요.', versions }
}

/** Put an older text back. The text it replaces is kept too, so this can be undone. */
export function restoreVersion(home: string, name: string, id: string): { ok: boolean; message: string } {
  if (!SAFE_NAME.test(name) || !/^\d+$/.test(id)) return { ok: false, message: '되돌릴 글을 찾지 못했어요.' }
  const old = readFile(path.join(historyDir(home, name), `${id}.md`))
  if (!old) return { ok: false, message: '되돌릴 글을 찾지 못했어요.' }
  const file = path.join(canonical(home), name, 'SKILL.md')
  if (!fs.existsSync(file)) return { ok: false, message: '그 스킬 글이 없어요.' }
  const current = readFile(file)
  if (current === old) return { ok: true, message: '지금 글과 같아요.' }
  keepHistory(home, name, current)
  fs.writeFileSync(file, old)
  remember(home, name, old)
  return { ok: true, message: '이전 글로 되돌렸어요. 방금 글도 이전 글에 보관했어요.' }
}

const HISTORY_KEEP = 10

function historyDir(home: string, name: string): string {
  return path.join(home, '.local', 'share', 'dios', 'skill-history', name)
}

/** Keep the text that is about to be replaced. Only the newest ten stay. */
function keepHistory(home: string, name: string, text: string): void {
  if (!text) return
  const dir = historyDir(home, name)
  fs.mkdirSync(dir, { recursive: true })
  const existing = fs.readdirSync(dir).filter((file) => /^\d+\.md$/.test(file)).sort()
  if (existing.length && readFile(path.join(dir, existing[existing.length - 1])) === text) return
  let id = Date.now()
  while (fs.existsSync(path.join(dir, `${id}.md`))) id += 1
  fs.writeFileSync(path.join(dir, `${id}.md`), text)
  const all = fs.readdirSync(dir).filter((file) => /^\d+\.md$/.test(file)).sort()
  for (const old of all.slice(0, Math.max(0, all.length - HISTORY_KEEP))) fs.rmSync(path.join(dir, old), { force: true })
}

function changedLines(before: string, after: string): number {
  const oldLines = new Set(before.split('\n').map((line) => line.trim()).filter(Boolean))
  const newLines = new Set(after.split('\n').map((line) => line.trim()).filter(Boolean))
  let count = 0
  for (const line of oldLines) if (!newLines.has(line)) count += 1
  for (const line of newLines) if (!oldLines.has(line)) count += 1
  return count
}

function canonical(home: string): string {
  return path.join(home, '.agents', 'skills')
}

function renderSkill(name: string, summary: string, steps: string[]): string {
  const body = steps.map((step) => `- ${step}`).join('\n')
  return `---\nname: ${name}\ndescription: ${summary}\n---\n\n# ${name}\n\n${body}\n`
}

function remember(home: string, name: string, text: string): void {
  const file = path.join(home, '.local', 'share', 'dios', 'skill-watch.json')
  let watch: { skills: Record<string, { hash: string; body: string }> } = { skills: {} }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { skills?: Record<string, { hash: string; body: string }> }
    if (parsed.skills) watch = { skills: parsed.skills }
  } catch {
    // The first save becomes the baseline.
  }
  watch.skills[name] = { hash: crypto.createHash('sha256').update(text).digest('hex'), body: text.slice(0, 20000) }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(watch, null, 2)}\n`)
}

function countNewLines(before: string, after: string): number {
  const old = new Set(before.split('\n').map((line) => line.trim()).filter(Boolean))
  return after.split('\n').map((line) => line.trim()).filter((line) => line && !old.has(line)).length
}

function collect(root: string, dir: string, files: SkillFile[]): void {
  if (files.length >= MAX_FILES) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collect(root, full, files)
      continue
    }
    if (!entry.isFile() || files.length >= MAX_FILES) continue
    const stat = fs.statSync(full)
    if (stat.size > MAX_FILE) continue
    const text = fs.readFileSync(full)
    if (text.includes(0)) continue
    const rel = path.relative(root, full).split(path.sep).join('/')
    files.push({ path: rel, text: text.toString('utf8') })
  }
}

function safeDest(root: string, rel: string): string | null {
  if (!rel || rel.startsWith('/') || rel.includes('..') || rel.includes('\\')) return null
  const dest = path.resolve(root, rel)
  const base = path.resolve(root)
  if (dest !== base && !dest.startsWith(base + path.sep)) return null
  return dest
}

function readFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function guideText(home: string): string {
  const file = path.join(home, '.agents', 'skills', 'founder-gate-relay', 'always.md')
  const text = readFile(file)
  if (text.includes(MARKER)) return text.endsWith('\n') ? text : `${text}\n`
  return BUNDLED_GUIDE
}

function cursorWrap(guide: string): string {
  return `---\ndescription: Send Founder work to MainPC HumanGate before asking only in chat\nalwaysApply: true\n---\n\n${guide}`
}

function isOnlyCursorFront(text: string): boolean {
  return /^---\s*\ndescription:[\s\S]*alwaysApply:\s*true\s*\n---\s*$/.test(text.trim())
}

