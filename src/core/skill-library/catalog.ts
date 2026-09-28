import fs from 'fs'
import path from 'path'
import { skillStory, textPrint } from '../skill-board/model'
import { readBlurb, savedKoreanBlurb } from '../skill-board/translation-store'

/** One folder on this computer that holds a copy or a link of a skill. */
export interface SkillHome {
  /** Agent id from the skill board (claude, codex, cursor…), or a source id like canonical, cursor-builtin, hermes, folder. */
  id: string
  /** Korean-ready label: Claude, Codex, 공용 폴더, Cursor 기본 제공… */
  name: string
  path: string
  /** True when this folder only points at the canonical copy. */
  link: boolean
  /** True when this folder's text differs from the canonical copy. */
  different: boolean
}

/** One skill as the library shows it: one card per name, wherever the copies are. */
export interface LibrarySkill {
  name: string
  summary: string
  /** One Korean sentence, when a good one is saved. Empty until then. */
  korean: string
  /** Fingerprint of the canonical text, or of the first copy found. */
  print: string
  /** True when ~/.agents/skills has it, so agents can be attached from the board. */
  canonical: boolean
  homes: SkillHome[]
  /** Agent ids that have it, links or copies. */
  agents: string[]
  /** Who made it, in plain Korean. '' when nobody knows. */
  author: string
  /** Where it came from when DIOS added it (a URL or another computer). */
  source: string
  /** When this computer first had it. */
  createdAt: number
  updatedAt: number
  isNew: boolean
  fileCount: number
}

/** What DIOS remembers about a skill beyond the files: first sighting and how it got here. */
export interface LibraryMetaEntry {
  firstSeen: number
  addedBy?: string
  source?: string
  addedAt?: number
}

export interface LibraryMeta {
  version: 1
  skills: Record<string, LibraryMetaEntry>
}

interface FolderAgent {
  id: string
  name: string
  dir: string[]
}

/** Same agents as the skill board, in the same order. */
export const LIBRARY_AGENTS: FolderAgent[] = [
  { id: 'claude', name: 'Claude', dir: ['.claude', 'skills'] },
  { id: 'claude-team', name: 'Claude Team', dir: ['.claude-team', 'skills'] },
  { id: 'claude-pro', name: 'Claude Pro', dir: ['.claude-pro', 'skills'] },
  { id: 'codex', name: 'Codex', dir: ['.codex', 'skills'] },
  { id: 'cursor', name: 'Cursor', dir: ['.cursor', 'skills'] },
  { id: 'grok', name: 'Grok', dir: ['.grok', 'skills'] },
  { id: 'cline', name: 'Cline', dir: ['.cline', 'skills'] },
  { id: 'commandcode', name: 'CommandCode', dir: ['.commandcode', 'skills'] },
  { id: 'opencode', name: 'OpenCode', dir: ['.config', 'opencode', 'skills'] },
]

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/
const NEW_FOR_MS = 7 * 86_400_000
/** Category folders (like Hermes's) are searched this deep for SKILL.md. */
const EXTRA_DEPTH = 2

export function canonicalDir(home: string): string {
  return path.join(home, '.agents', 'skills')
}

export function libraryMetaPath(home: string): string {
  return path.join(home, '.local', 'share', 'dios', 'skill-library.json')
}

/** Folders other than agent folders that hold skills on this computer, when they exist. */
export function extraSkillRoots(home: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Array<{ id: string; name: string; path: string }> {
  const roots = [
    { id: 'cursor-builtin', name: 'Cursor 기본 제공', path: path.join(home, '.cursor', 'skills-cursor') },
    { id: 'hermes', name: 'Hermes', path: path.join(home, '.hermes', 'skills') },
    { id: 'hermes', name: 'Hermes', path: path.join(home, '.local', 'share', 'hermes', 'skills') },
  ]
  if (platform === 'win32') {
    // Only trust LOCALAPPDATA when it belongs to this home, so reading another home (or a test home) stays inside it.
    const fromEnv = env.LOCALAPPDATA || ''
    const insideHome = fromEnv && path.resolve(fromEnv).toLowerCase().startsWith(path.resolve(home).toLowerCase())
    const local = insideHome ? fromEnv : path.join(home, 'AppData', 'Local')
    roots.push({ id: 'hermes', name: 'Hermes', path: path.join(local, 'hermes', 'skills') })
  }
  return roots.filter((root) => fs.existsSync(root.path))
}

/**
 * Every skill on this computer, one card per name.
 * `extraRoots` are folders the Founder connected (프로젝트 자료 연결 → Skills 폴더).
 */
export function readLibrary(home: string, extraRoots: string[] = [], now: Date = new Date()): LibrarySkill[] {
  const metaPath = libraryMetaPath(home)
  const meta = readMeta(metaPath)
  const firstRun = Object.keys(meta.skills).length === 0
  const found = new Map<string, Array<SkillHome & { text: string; stat: fs.Stats | null; files: number }>>()

  const add = (id: string, name: string, dir: string, depth: number) => {
    for (const skillDir of listSkillDirs(dir, depth)) {
      const skillName = path.basename(skillDir)
      const file = path.join(skillDir, 'SKILL.md')
      const text = readText(file)
      if (!text) continue
      const list = found.get(skillName) ?? []
      list.push({ id, name, path: skillDir, link: isLink(skillDir), different: false, text, stat: statOf(file), files: countFiles(skillDir) })
      found.set(skillName, list)
    }
  }

  add('canonical', '공용 폴더', canonicalDir(home), 1)
  for (const agent of LIBRARY_AGENTS) add(agent.id, agent.name, path.join(home, ...agent.dir), 1)
  for (const root of extraSkillRoots(home)) add(root.id, root.name, root.path, EXTRA_DEPTH)
  for (const root of extraRoots) if (root && fs.existsSync(root)) add('folder', path.basename(root) || root, root, EXTRA_DEPTH)

  let metaDirty = false
  const skills: LibrarySkill[] = []
  for (const [name, copies] of [...found.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const canonical = copies.find((copy) => copy.id === 'canonical')
    const base = canonical ?? copies[0]
    const basePrint = textPrint(base.text)
    const homes: SkillHome[] = copies
      .filter((copy) => copy.id !== 'canonical')
      .map(({ text, stat, files, ...home }) => ({ ...home, different: !home.link && textPrint(text) !== basePrint }))
    const agentIds = new Set(LIBRARY_AGENTS.map((agent) => agent.id))
    const agents = homes.filter((home) => agentIds.has(home.id)).map((home) => home.id)
    const births = copies.map((copy) => copy.stat?.birthtimeMs || copy.stat?.mtimeMs || 0).filter(Boolean)
    const updates = copies.map((copy) => copy.stat?.mtimeMs || 0)
    let entry = meta.skills[name]
    if (!entry) {
      // Skills already here when the library first runs are not "new"; only later arrivals are.
      entry = { firstSeen: firstRun ? Math.min(...births, now.getTime()) : now.getTime() }
      meta.skills[name] = entry
      metaDirty = true
    }
    const front = frontmatter(base.text)
    skills.push({
      name,
      summary: skillStory(base.text).summary || front.description,
      korean: readBlurb(home, name, basePrint) || savedKoreanBlurb(home, 'local', name, basePrint),
      print: basePrint,
      canonical: Boolean(canonical),
      homes,
      agents,
      author: authorOf(front, entry, homes, Boolean(canonical)),
      source: entry.source ?? '',
      createdAt: entry.firstSeen,
      updatedAt: Math.max(0, ...updates),
      isNew: now.getTime() - entry.firstSeen < NEW_FOR_MS,
      fileCount: base.files,
    })
  }

  for (const name of Object.keys(meta.skills)) {
    if (!found.has(name)) {
      delete meta.skills[name]
      metaDirty = true
    }
  }
  if (metaDirty) writeMeta(metaPath, meta)
  return skills
}

/** Remember how a skill got here, so the card can say who added it and from where. */
export function rememberAdded(home: string, name: string, addedBy: string, source: string, now: Date = new Date()): void {
  const metaPath = libraryMetaPath(home)
  const meta = readMeta(metaPath)
  const entry = meta.skills[name] ?? { firstSeen: now.getTime() }
  meta.skills[name] = { ...entry, addedBy, source, addedAt: now.getTime() }
  writeMeta(metaPath, meta)
}

/** Fields the library reads from the top of SKILL.md. */
export interface SkillFront {
  name: string
  description: string
  author: string
}

/** A small reader for the YAML block at the top of SKILL.md: name, description, and any author line. */
export function frontmatter(text: string): SkillFront {
  const out: SkillFront = { name: '', description: '', author: '' }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return out
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^\s*([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (!pair) continue
    const key = pair[1].toLowerCase()
    const value = pair[2].trim().replace(/^["']|["']$/g, '')
    if (key === 'name' && !out.name) out.name = value
    else if (key === 'description' && !out.description) out.description = value
    else if (['author', 'authors', 'created-by', 'created_by', 'createdby', 'made-by', 'owner', 'maintainer'].includes(key) && value && !out.author) out.author = value
  }
  return out
}

/** Who made the skill, in the Founder's words. */
export function authorOf(front: SkillFront, entry: LibraryMetaEntry, homes: SkillHome[], canonical: boolean): string {
  if (entry.addedBy) return entry.addedBy
  if (front.author) return front.author
  if (homes.some((home) => home.id === 'cursor-builtin') && homes.length === 1 && !canonical) return 'Cursor 기본 제공'
  if (homes.some((home) => home.id === 'hermes') && homes.length === 1 && !canonical) return 'Hermes'
  const realCopies = homes.filter((home) => !home.link && home.id !== 'folder')
  if (!canonical && realCopies.length === 1) return `${realCopies[0].name} 폴더에서 나왔어요`
  return ''
}

/** Read the library's memory. Missing or broken files start fresh. */
export function readMeta(file: string): LibraryMeta {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as LibraryMeta
    if (parsed && parsed.version === 1 && parsed.skills) return parsed
  } catch {
    // First run, or a file that is not ours.
  }
  return { version: 1, skills: {} }
}

function writeMeta(file: string, meta: LibraryMeta): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(meta, null, 2))
  } catch {
    // Without the memory every skill just counts as new next time; nothing is lost.
  }
}

function listSkillDirs(dir: string, depth: number): string[] {
  const out: string[] = []
  const walk = (current: string, left: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const full = path.join(current, entry.name)
      if (fs.existsSync(path.join(full, 'SKILL.md'))) {
        if (SAFE_NAME.test(entry.name)) out.push(full)
      } else if (left > 1 && !entry.name.startsWith('.')) {
        walk(full, left - 1)
      }
    }
  }
  walk(dir, depth)
  return out
}

function isLink(dir: string): boolean {
  try {
    return fs.lstatSync(dir).isSymbolicLink()
  } catch {
    return false
  }
}

function statOf(file: string): fs.Stats | null {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}

function countFiles(dir: string): number {
  let count = 0
  const walk = (current: string, depth: number) => {
    if (depth > 4) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isFile()) count += 1
      else if (entry.isDirectory()) walk(path.join(current, entry.name), depth + 1)
    }
  }
  walk(dir, 0)
  return count
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
