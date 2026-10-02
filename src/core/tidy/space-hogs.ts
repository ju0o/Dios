import fs from 'fs'
import path from 'path'
import type { HeavyFolder, HeavyKind } from './types'

/** Folder names that can always be rebuilt from the project itself. */
const HEAVY_NAMES: Record<string, HeavyKind> = {
  node_modules: 'node_modules',
  '.venv': 'venv',
  venv: 'venv',
  dist: 'build',
  'dist-electron': 'build',
  build: 'build',
  out: 'build',
  release: 'build',
  '.next': 'build',
  '.nuxt': 'build',
  target: 'build',
  __pycache__: 'cache',
  '.cache': 'cache',
  '.turbo': 'cache',
  '.parcel-cache': 'cache',
  coverage: 'cache',
}

/** Folders never entered while looking for heavy ones. */
const SKIP_WALK = new Set(['.git', 'Library', 'AppData', '.local', '.npm', '.cargo', '.rustup', '.gradle', '.m2'])

export const KIND_LABEL: Record<HeavyKind, string> = {
  node_modules: '설치한 꾸러미 (node_modules)',
  venv: 'Python 가상 환경',
  build: '만들어 낸 결과물',
  cache: '임시 저장',
  temp: '임시 파일 폴더',
  worktree: '따로 꺼내 둔 작업 폴더',
}

export interface SizeResult {
  bytes: number
  files: number
  /** True when the file budget ran out, so bytes is a lower bound. */
  approx: boolean
}

/** Add up a folder, stopping at `budget` files so a giant node_modules cannot stall the app. */
export function folderSize(dir: string, budget = 60000): SizeResult {
  const out: SizeResult = { bytes: 0, files: 0, approx: false }
  const stack = [dir]
  while (stack.length && out.files < budget) {
    const current = stack.pop() as string
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (out.files >= budget) break
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try {
          out.bytes += fs.statSync(full).size
          out.files += 1
        } catch {
          // Unreadable file: skip it, the total is still a fair picture.
        }
      }
    }
  }
  if (stack.length || out.files >= budget) out.approx = true
  return out
}

/** When a project was last worked on, judged by its own bookkeeping files. */
export function projectTouchedAt(projectDir: string): number {
  const candidates = ['.git/index', '.git/HEAD', '.git/FETCH_HEAD', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'src', 'README.md']
  let latest = 0
  for (const name of candidates) {
    try {
      const ms = fs.statSync(path.join(projectDir, name)).mtimeMs
      if (ms > latest) latest = ms
    } catch {
      // Missing marker: fine.
    }
  }
  if (!latest) {
    try {
      latest = fs.statSync(projectDir).mtimeMs
    } catch {
      latest = 0
    }
  }
  return Math.floor(latest)
}

export interface HeavyOptions {
  maxDepth?: number
  /** Stop after this many heavy folders. */
  limit?: number
  /** File budget per folder when sizing. */
  sizeBudget?: number
  /** Only folders at least this big are reported (bytes). */
  minBytes?: number
}

/** Heavy folders under the given roots, biggest first. */
export function findHeavyFolders(roots: string[], options: HeavyOptions = {}): HeavyFolder[] {
  const maxDepth = options.maxDepth ?? 4
  const limit = options.limit ?? 120
  const minBytes = options.minBytes ?? 20 * 1024 * 1024
  const found: HeavyFolder[] = []
  const seen = new Set<string>()
  const walk = (dir: string, depth: number) => {
    if (found.length >= limit) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= limit) return
      if (!entry.isDirectory() || entry.isSymbolicLink() || SKIP_WALK.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      const kind = HEAVY_NAMES[entry.name]
      if (kind) {
        const key = path.resolve(full)
        if (seen.has(key)) continue
        seen.add(key)
        const size = folderSize(full, options.sizeBudget)
        if (size.bytes >= minBytes) {
          found.push({ path: key, kind, project: dir, bytes: size.bytes, files: size.files, approx: size.approx, projectTouchedAt: projectTouchedAt(dir) })
        }
        continue
      }
      if (depth < maxDepth) walk(full, depth + 1)
    }
  }
  for (const root of roots) {
    if (fs.existsSync(root)) walk(path.resolve(root), 0)
  }
  return found.sort((left, right) => right.bytes - left.bytes)
}

/** The system temp folder as one row, sized with a small budget. */
export function tempFolderRow(tempDir: string, budget = 20000): HeavyFolder | null {
  if (!tempDir || !fs.existsSync(tempDir)) return null
  const size = folderSize(tempDir, budget)
  return { path: tempDir, kind: 'temp', project: '', bytes: size.bytes, files: size.files, approx: size.approx, projectTouchedAt: 0 }
}

/** "약 2.3GB", "약 512MB", "1MB 미만". */
export function bytesText(bytes: number, approx = false): string {
  const prefix = approx ? '적어도 ' : '약 '
  if (bytes < 1048576) return '1MB 미만'
  if (bytes < 1073741824) return `${prefix}${Math.round(bytes / 1048576)}MB`
  const gb = bytes / 1073741824
  return `${prefix}${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10}GB`
}

/** "3일 전", "2달 전", "1년 넘게 전". */
export function ageText(ms: number, now: number = Date.now()): string {
  if (!ms) return '언제인지 몰라요'
  const days = Math.floor((now - ms) / 86_400_000)
  if (days < 1) return '오늘'
  if (days < 30) return `${days}일 전`
  if (days < 365) return `${Math.floor(days / 30)}달 전`
  return '1년 넘게 전'
}

export const STALE_DAYS = 30

/** True when the owning project has not been touched for a month. */
export function heavyIsStale(entry: HeavyFolder, now: number = Date.now()): boolean {
  return entry.kind !== 'temp' && entry.projectTouchedAt > 0 && now - entry.projectTouchedAt > STALE_DAYS * 86_400_000
}

/** One plain Korean line for a heavy-folder row. */
export function heavyLine(entry: HeavyFolder, now: number = Date.now()): string {
  const size = bytesText(entry.bytes, entry.approx)
  if (entry.kind === 'temp') return `${size} · 프로그램들이 잠깐 쓰고 두고 간 파일이에요.`
  const age = ageText(entry.projectTouchedAt, now)
  const touched = entry.projectTouchedAt ? `프로젝트는 ${age === '오늘' ? '오늘' : `${age}에`} 마지막으로 손댔어요` : ''
  const rebuild = entry.kind === 'node_modules' ? '지워도 npm install로 다시 생겨요' : entry.kind === 'venv' ? '지워도 다시 만들 수 있어요' : entry.kind === 'build' ? '다시 빌드하면 생겨요' : '지워도 돼요'
  return [size, touched, rebuild].filter(Boolean).join(' · ')
}

/** Total bytes across rows, for the headline. */
export function heavyTotal(rows: HeavyFolder[]): number {
  return rows.reduce((sum, row) => sum + row.bytes, 0)
}
