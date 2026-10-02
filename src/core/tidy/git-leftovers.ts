import fs from 'fs'
import path from 'path'
import type { RepoLeftover, Runner, WorktreeEntry } from './types'

/** Folders that never hold a project of their own. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'build', 'out', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'target', '.cache', 'coverage', '.idea', '.vscode', 'Library', 'AppData', '.local', '.npm', '.cargo'])

export const DEFAULT_REPO_DEPTH = 3
export const DEFAULT_REPO_LIMIT = 60

/**
 * Git projects under the given folders. A folder with `.git` is a project and is not
 * searched further, so nested worktrees and submodules are left to git itself.
 */
export function findRepos(roots: string[], maxDepth = DEFAULT_REPO_DEPTH, limit = DEFAULT_REPO_LIMIT): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const walk = (dir: string, depth: number) => {
    if (found.length >= limit) return
    const marker = path.join(dir, '.git')
    if (fs.existsSync(marker)) {
      const key = path.resolve(dir)
      if (!seen.has(key)) {
        seen.add(key)
        found.push(key)
      }
      return
    }
    if (depth >= maxDepth) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= limit) return
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      walk(path.join(dir, entry.name), depth + 1)
    }
  }
  for (const root of roots) {
    if (fs.existsSync(root)) walk(path.resolve(root), 0)
  }
  return found
}

export interface StatusSummary {
  branch: string
  hasUpstream: boolean
  ahead: number
  behind: number
  changed: number
  untracked: number
}

/** Read `git status --porcelain=v2 --branch`. */
export function parseStatusBranch(text: string): StatusSummary {
  const out: StatusSummary = { branch: '', hasUpstream: false, ahead: 0, behind: 0, changed: 0, untracked: 0 }
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue
    if (raw.startsWith('# branch.head ')) out.branch = raw.slice('# branch.head '.length).trim()
    else if (raw.startsWith('# branch.upstream ')) out.hasUpstream = true
    else if (raw.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(raw)
      if (match) {
        out.ahead = Number(match[1])
        out.behind = Number(match[2])
      }
    } else if (raw.startsWith('1 ') || raw.startsWith('2 ') || raw.startsWith('u ')) out.changed += 1
    else if (raw.startsWith('? ')) out.untracked += 1
  }
  return out
}

/** Read `git worktree list --porcelain`. The first block is the main folder. */
export function parseWorktrees(text: string, exists: (dir: string) => boolean = (dir) => fs.existsSync(dir)): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | null = null
  const flush = () => {
    if (current) entries.push(current)
    current = null
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      const dir = line.slice('worktree '.length)
      current = { path: dir, branch: '', prunable: false, exists: exists(dir) }
    } else if (!current) continue
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    else if (line === 'detached') current.branch = '(분리됨)'
    else if (line.startsWith('prunable')) current.prunable = true
  }
  flush()
  return entries
}

/** Ask git about one project. Never throws; a failed read is reported in the row. */
export async function repoLeftovers(run: Runner, repo: string): Promise<RepoLeftover> {
  const base: RepoLeftover = {
    repo,
    name: path.basename(repo) || repo,
    branch: '',
    changed: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    hasUpstream: false,
    worktrees: [],
    partOf: '',
    lastCommitAt: 0,
    failed: false,
  }
  const options = { cwd: repo, timeoutMs: 15000 }
  try {
    const status = await run('git', ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'], options)
    if (status.code !== 0) return { ...base, failed: true }
    const summary = parseStatusBranch(status.stdout)
    const [trees, log] = await Promise.all([
      run('git', ['worktree', 'list', '--porcelain'], options).catch(() => ({ code: 1, stdout: '', stderr: '' })),
      run('git', ['log', '-1', '--format=%ct'], options).catch(() => ({ code: 1, stdout: '', stderr: '' })),
    ])
    const all = trees.code === 0 ? parseWorktrees(trees.stdout) : []
    // The first entry is the main folder. A secondary copy reports no list of its own, so the
    // same 20 folders do not show once per copy.
    const main = all[0] ? path.resolve(all[0].path) : ''
    const isCopy = Boolean(main) && main !== path.resolve(repo)
    const seconds = Number(log.stdout.trim())
    return {
      ...base,
      ...summary,
      worktrees: isCopy ? [] : all.slice(1),
      partOf: isCopy ? main : '',
      lastCommitAt: log.code === 0 && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
    }
  } catch {
    return { ...base, failed: true }
  }
}

/** True when the row needs the Founder's eyes. */
export function repoNeedsAttention(repo: RepoLeftover): boolean {
  if (repo.failed) return false
  return repo.changed + repo.untracked > 0 || repo.ahead > 0 || repo.worktrees.some((tree) => tree.prunable || !tree.exists)
}

/** One plain Korean line for a project row. */
export function repoLine(repo: RepoLeftover): string {
  if (repo.failed) return 'git이 읽히지 않았어요. 폴더를 열어 확인해 주세요.'
  const parts: string[] = []
  const unsaved = repo.changed + repo.untracked
  if (unsaved > 0) parts.push(`저장 안 한 수정 ${unsaved}개`)
  if (repo.ahead > 0) parts.push(`올리지 않은 기록 ${repo.ahead}개`)
  if (repo.behind > 0) parts.push(`받지 않은 기록 ${repo.behind}개`)
  const gone = repo.worktrees.filter((tree) => tree.prunable || !tree.exists).length
  const extra = repo.worktrees.length - gone
  if (gone > 0) parts.push(`사라진 작업 폴더 ${gone}개`)
  if (extra > 0) parts.push(`따로 꺼내 둔 작업 폴더 ${extra}개`)
  if (!parts.length) return repo.hasUpstream ? '깨끗해요. 전부 저장했고 올렸어요.' : '깨끗해요. 올릴 곳(원격)은 없어요.'
  if (!repo.hasUpstream && repo.ahead === 0) parts.push('올릴 곳(원격) 없음')
  return parts.join(' · ')
}

/** True when there is work in the files or commits that never left this computer. */
export function repoHasUnsaved(repo: RepoLeftover): boolean {
  return !repo.failed && (repo.changed + repo.untracked > 0 || repo.ahead > 0)
}
