import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { dayOf } from './usage-time'

/** Which desktop agent wrote the log. Cursor keeps counts, not tokens. */
export type LogTool = 'claude_code' | 'codex' | 'cursor'

/** What one agent used on one day, in one project folder, with one model. */
export interface UsageEntry {
  tool: LogTool
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  /** Folder the agent worked in (basename), or '' when unknown. */
  project: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Requests that day (Cursor). Token tools leave this out. */
  count?: number
  /** Distinct chats that day (Cursor). */
  chats?: number
}

/** Called while the logs are read, so the screen can show how far along the first read is. */
export type UsageProgress = (done: number, total: number) => void

interface FileCache {
  size: number
  mtime: number
  entries: UsageEntry[]
}

interface CacheFile {
  version: number
  files: Record<string, FileCache>
}

const CACHE_VERSION = 2
/** Files older than this are not read; the screen shows this month and last month. */
const LOOKBACK_DAYS = 62
const MAX_FILE_BYTES = 80 * 1024 * 1024

/** Where the per-file summaries live, so the second open reads only files that changed. */
export function usageCachePath(home: string): string {
  return path.join(home, '.local', 'share', 'dios', 'usage-cache.json')
}

/**
 * Read Claude Code and Codex logs under `home` into daily entries.
 * Only files changed since the last run are parsed again; nothing runs in the background.
 */
export function readLocalUsage(home: string, now: Date = new Date()): UsageEntry[] {
  const plan = planRead(home, now)
  for (const item of plan.fresh) parseFresh(plan, item)
  return finishRead(plan, home, now)
}

/**
 * Same as readLocalUsage, but gives the event loop a turn between files so progress reaches the
 * window while a long first read is going on.
 */
export async function readLocalUsageAsync(home: string, now: Date = new Date(), onProgress?: UsageProgress): Promise<UsageEntry[]> {
  const plan = planRead(home, now)
  let done = 0
  if (plan.fresh.length) onProgress?.(0, plan.fresh.length)
  for (const item of plan.fresh) {
    parseFresh(plan, item)
    done += 1
    if (done % 5 === 0 || done === plan.fresh.length) {
      onProgress?.(done, plan.fresh.length)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  return finishRead(plan, home, now)
}

interface ReadPlan {
  cachePath: string
  next: CacheFile
  entries: UsageEntry[]
  fresh: Array<{ file: string; tool: LogTool; stat: fs.Stats }>
}

function planRead(home: string, now: Date): ReadPlan {
  const cachePath = usageCachePath(home)
  const cache = loadCache(cachePath)
  const cutoff = now.getTime() - LOOKBACK_DAYS * 86_400_000
  const files = [
    ...claudeFiles(home).map((file) => ({ file, tool: 'claude_code' as LogTool })),
    ...codexFiles(home).map((file) => ({ file, tool: 'codex' as LogTool })),
  ]
  const plan: ReadPlan = { cachePath, next: { version: CACHE_VERSION, files: {} }, entries: [], fresh: [] }
  for (const { file, tool } of files) {
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    if (stat.mtimeMs < cutoff || stat.size > MAX_FILE_BYTES) continue
    const known = cache.files[file]
    if (known && known.size === stat.size && known.mtime === stat.mtimeMs) {
      plan.next.files[file] = known
      plan.entries.push(...known.entries)
    } else {
      plan.fresh.push({ file, tool, stat })
    }
  }
  return plan
}

function parseFresh(plan: ReadPlan, item: ReadPlan['fresh'][number]): void {
  const parsed = parseFile(item.file, item.tool)
  plan.next.files[item.file] = { size: item.stat.size, mtime: item.stat.mtimeMs, entries: parsed }
  plan.entries.push(...parsed)
}

function finishRead(plan: ReadPlan, home: string, now: Date): UsageEntry[] {
  saveCache(plan.cachePath, plan.next)
  plan.entries.push(...readCursorUsage(home, now))
  return mergeEntries(plan.entries)
}

/**
 * Cursor keeps a small database of the code it wrote, with the request, chat, and model for each
 * piece. It gives how often Cursor was used, not tokens, so these entries carry counts only.
 */
export function readCursorUsage(home: string, now: Date = new Date()): UsageEntry[] {
  const file = path.join(home, '.cursor', 'ai-tracking', 'ai-code-tracking.db')
  if (!fs.existsSync(file)) return []
  const since = now.getTime() - LOOKBACK_DAYS * 86_400_000
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    const rows = db.prepare('SELECT timestamp, model, fileName, requestId, conversationId FROM ai_code_hashes WHERE timestamp >= ?').all(since) as Array<{ timestamp: number; model: string | null; fileName: string | null; requestId: string | null; conversationId: string | null }>
    return cursorEntries(rows, now)
  } catch {
    return []
  } finally {
    db?.close()
  }
}

/** Distinct requests and chats per day, project, and model. Exported for the test. */
export function cursorEntries(rows: Array<{ timestamp: number; model: string | null; fileName: string | null; requestId: string | null; conversationId: string | null }>, now: Date = new Date()): UsageEntry[] {
  const groups = new Map<string, { day: string; project: string; model: string; requests: Set<string>; chats: Set<string> }>()
  for (const row of rows) {
    const day = dayOf(new Date(row.timestamp).toISOString(), now)
    const project = projectFromFile(row.fileName ?? '')
    const model = row.model || 'cursor'
    const key = `${day}\n${project}\n${model}`
    const group = groups.get(key) ?? { day, project, model, requests: new Set<string>(), chats: new Set<string>() }
    if (row.requestId) group.requests.add(row.requestId)
    if (row.conversationId) group.chats.add(row.conversationId)
    groups.set(key, group)
  }
  return [...groups.values()]
    .filter((group) => group.requests.size > 0)
    .map((group) => ({ tool: 'cursor' as LogTool, day: group.day, project: group.project, model: group.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: group.requests.size, chats: group.chats.size }))
}

/** Folders that hold projects rather than being one. */
const GROUP_FOLDERS = new Set(['projects', 'core', 'team', 'personal', 'work', 'src', 'repos', 'code', 'dev', 'desktop', 'documents'])
/** Folders right above a user's projects: the first real folder after one of these is the project. */
const ANCHORS = new Set(['projects', 'src', 'repos', 'code', 'dev', 'users', 'home'])

/**
 * The project folder a file belongs to. …/Projects/Team/JuCeipt/src/a.ts gives JuCeipt,
 * C:\Users\user\src\Dios\electron\main.ts gives Dios, and a worktree path gives the folder under it.
 */
export function projectFromFile(file: string): string {
  const parts = file.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 2) return ''
  const worktree = parts.findIndex((part) => /worktrees?$/i.test(part))
  if (worktree >= 0 && parts[worktree + 1]) return parts[worktree + 1]
  const lowered = parts.map((part) => part.toLowerCase())
  let anchor = lowered.findIndex((part) => part === 'projects')
  if (anchor < 0) {
    const user = lowered.findIndex((part) => part === 'users' || part === 'home')
    anchor = user >= 0 ? user + 1 : lowered.findIndex((part) => ANCHORS.has(part))
  }
  if (anchor >= 0) {
    let index = anchor + 1
    while (index < parts.length - 1 && (GROUP_FOLDERS.has(lowered[index]) || parts[index].startsWith('.'))) index += 1
    if (index < parts.length - 1) return parts[index]
  }
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (!GROUP_FOLDERS.has(lowered[index]) && !parts[index].startsWith('.')) return parts[index]
  }
  return ''
}

/** Entries from the last run only, without touching the logs. For the badge at start. */
export function readCachedUsage(home: string): UsageEntry[] {
  const cache = loadCache(usageCachePath(home))
  const entries: UsageEntry[] = []
  for (const file of Object.values(cache.files)) entries.push(...file.entries)
  return mergeEntries(entries)
}

/** The folder a Claude or Codex session ran in, for the Founder's project list. */
function projectOfCwd(cwd: string | undefined): string {
  if (!cwd) return ''
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  const worktree = parts.findIndex((part) => /worktrees?$/i.test(part))
  if (worktree >= 0 && parts[worktree + 1]) return parts[worktree + 1]
  return parts[parts.length - 1] ?? ''
}

/** Sum entries that share tool, day, project, and model. */
export function mergeEntries(entries: UsageEntry[]): UsageEntry[] {
  const byKey = new Map<string, UsageEntry>()
  for (const entry of entries) {
    const key = `${entry.tool}\n${entry.day}\n${entry.project}\n${entry.model}`
    const seen = byKey.get(key)
    if (!seen) {
      byKey.set(key, { ...entry })
      continue
    }
    seen.input += entry.input
    seen.output += entry.output
    seen.cacheRead += entry.cacheRead
    seen.cacheWrite += entry.cacheWrite
    if (entry.count || seen.count) seen.count = (seen.count ?? 0) + (entry.count ?? 0)
    if (entry.chats || seen.chats) seen.chats = (seen.chats ?? 0) + (entry.chats ?? 0)
  }
  return [...byKey.values()].sort((left, right) => left.day.localeCompare(right.day))
}

function claudeFiles(home: string): string[] {
  const root = path.join(home, '.claude', 'projects')
  const out: string[] = []
  for (const dir of listDirs(root)) {
    for (const name of listFiles(dir)) {
      if (name.endsWith('.jsonl')) out.push(path.join(dir, name))
    }
  }
  return out
}

function codexFiles(home: string): string[] {
  const root = path.join(home, '.codex', 'sessions')
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return
    for (const name of listFiles(dir)) {
      if (name.endsWith('.jsonl')) out.push(path.join(dir, name))
    }
    for (const sub of listDirs(dir)) walk(sub, depth + 1)
  }
  walk(root, 0)
  return out
}

function parseFile(file: string, tool: LogTool): UsageEntry[] {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  return tool === 'claude_code' ? parseClaudeLines(text) : parseCodexLines(text)
}

/**
 * Claude Code writes one line per content block; the same message id repeats with the same usage,
 * so a message is counted once.
 */
export function parseClaudeLines(text: string): UsageEntry[] {
  const seen = new Set<string>()
  const out: UsageEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue
    let row: ClaudeLine
    try {
      row = JSON.parse(line) as ClaudeLine
    } catch {
      continue
    }
    const message = row.message
    const usage = message?.usage
    if (row.type !== 'assistant' || !usage) continue
    const id = message?.id || row.requestId || row.uuid || ''
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    const model = message?.model || ''
    if (!model || model === '<synthetic>') continue
    out.push({
      tool: 'claude_code',
      day: dayOf(row.timestamp),
      project: projectOf(row.cwd),
      model,
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
    })
  }
  return mergeEntries(out)
}

/**
 * Codex keeps a running total per session in token_count events. Each event's increase over the
 * previous one is the usage of that moment, so a session that spans midnight lands on both days.
 */
export function parseCodexLines(text: string): UsageEntry[] {
  const out: UsageEntry[] = []
  let cwd = ''
  let model = ''
  let last = { input: 0, output: 0, cached: 0, cacheWrite: 0 }
  for (const line of text.split('\n')) {
    if (!line.includes('"cwd"') && !line.includes('"model"') && !line.includes('token_count')) continue
    let row: CodexLine
    try {
      row = JSON.parse(line) as CodexLine
    } catch {
      continue
    }
    const payload = row.payload
    if (!payload) continue
    if (typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd
    if (typeof payload.model === 'string' && payload.model) model = payload.model
    const total = payload.type === 'token_count' ? payload.info?.total_token_usage : undefined
    if (!total) continue
    const now = {
      input: num(total.input_tokens),
      output: num(total.output_tokens),
      cached: num(total.cached_input_tokens),
      cacheWrite: num(total.cache_write_input_tokens),
    }
    const delta = {
      input: Math.max(0, now.input - last.input),
      output: Math.max(0, now.output - last.output),
      cached: Math.max(0, now.cached - last.cached),
      cacheWrite: Math.max(0, now.cacheWrite - last.cacheWrite),
    }
    last = now
    if (!delta.input && !delta.output) continue
    out.push({
      tool: 'codex',
      day: dayOf(row.timestamp),
      project: projectOf(cwd),
      model: model || 'gpt-5',
      // Codex reports input including the cached part; keep uncached input separate for pricing.
      input: Math.max(0, delta.input - delta.cached),
      output: delta.output,
      cacheRead: delta.cached,
      cacheWrite: delta.cacheWrite,
    })
  }
  return mergeEntries(out)
}

interface ClaudeLine {
  type?: string
  timestamp?: string
  cwd?: string
  requestId?: string
  uuid?: string
  message?: {
    id?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

interface CodexLine {
  timestamp?: string
  type?: string
  payload?: {
    type?: string
    cwd?: string
    model?: string
    info?: {
      total_token_usage?: {
        input_tokens?: number
        cached_input_tokens?: number
        cache_write_input_tokens?: number
        output_tokens?: number
      }
    }
  }
}

/** The folder name the agent worked in, from a Windows or POSIX path. */
export function projectOf(cwd: string | undefined): string {
  return projectOfCwd(cwd)
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name))
  } catch {
    return []
  }
}

function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch {
    return []
  }
}

function loadCache(file: string): CacheFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheFile
    if (parsed.version === CACHE_VERSION && parsed.files) return parsed
  } catch {
    // No cache yet, or an older shape: read everything once.
  }
  return { version: CACHE_VERSION, files: {} }
}

function saveCache(file: string, cache: CacheFile): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.dios-tmp`
    fs.writeFileSync(tmp, JSON.stringify(cache))
    fs.renameSync(tmp, file)
  } catch {
    // A cache that cannot be written only costs time on the next open.
  }
}
