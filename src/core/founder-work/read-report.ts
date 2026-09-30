import fs from 'fs'
import path from 'path'
import { noteSummary, parseGate, resultFull, resultNote, type OpenTask, type PastTask } from './parse-gate'

export interface FounderWork {
  found: boolean
  open: OpenTask[]
  done: PastTask[]
  blocked: PastTask[]
}

const PAST_LIMIT = 12

/** Where the relay skill writes on MainPC. Empty when this computer has no such folder. */
export function defaultReportRoot(platform: string, exists: (target: string) => boolean = fs.existsSync): string {
  const override = process.env.DIOS_REPORT_ROOT
  if (override && exists(override)) return override
  if (platform === 'win32' && exists('E:\\AI_Report\\00_NOW')) return 'E:\\AI_Report'
  return ''
}

/** Read open Aside/Founder tasks and the newest finished or blocked ones. */
export function readReport(root: string): FounderWork {
  if (!root || !fs.existsSync(root)) return { found: false, open: [], done: [], blocked: [] }
  const now = path.join(root, '00_NOW')
  const open = [
    ...readOpen(path.join(now, 'Aside'), 'aside'),
    ...readOpen(path.join(now, 'Founder'), 'founder'),
  ].sort((left, right) => right.updatedAt - left.updatedAt)
  const past = [
    ...readPast(path.join(root, '01_ARCHIVE')),
    ...readPast(path.join(now, '01_ARCHIVE')),
  ]
  const seen = new Set<string>()
  const unique = past.filter((item) => {
    const key = `${item.status}\n${item.project}\n${item.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((left, right) => right.updatedAt - left.updatedAt)
  return {
    found: true,
    open,
    done: unique.filter((item) => item.status === 'done').slice(0, PAST_LIMIT),
    blocked: unique.filter((item) => item.status === 'blocked').slice(0, PAST_LIMIT),
  }
}

function readOpen(dir: string, kind: 'aside' | 'founder'): OpenTask[] {
  return mdFiles(dir, false).map((file) => parseGate(readText(file), kind, path.basename(file), mtime(file)))
}

function readPast(dir: string): PastTask[] {
  const files = mdFiles(dir, true)
  const notes = new Map<string, { note: string; fullNote: string }>()
  for (const file of files) {
    if (path.basename(file).toLowerCase() === 'result.md') {
      const text = readText(file)
      notes.set(path.dirname(file), { note: noteSummary(resultNote(text)), fullNote: resultFull(text) })
    }
  }
  const tasks: PastTask[] = []
  for (const file of files) {
    if (path.basename(file).toLowerCase() === 'result.md') continue
    const relative = path.relative(dir, file)
    const status = folderStatus(relative)
    if (!status) continue
    const parsed = parseGate(readText(file), 'founder', path.basename(file), mtime(file))
    const parts = relative.split(path.sep)
    const marker = parts.indexOf(status === 'done' ? 'DONE' : 'BLOCKED')
    const project = marker > 0 ? parts[marker - 1] : parsed.project
    const saved = notes.get(path.dirname(file))
    tasks.push({ status, project, title: parsed.title, note: saved?.note ?? '', fullNote: saved?.fullNote ?? '', updatedAt: parsed.updatedAt })
  }
  return tasks
}

function folderStatus(relative: string): 'done' | 'blocked' | '' {
  const parts = relative.split(path.sep)
  if (parts.includes('DONE')) return 'done'
  if (parts.includes('BLOCKED')) return 'blocked'
  return ''
}

function mdFiles(dir: string, deep: boolean): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  const walk = (current: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (deep && depth < 6 && entry.name !== 'node_modules') walk(full, depth + 1)
        continue
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name.toLowerCase() !== 'readme.md') out.push(full)
    }
  }
  walk(dir, 0)
  return out
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}
