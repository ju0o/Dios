/**
 * Shapes shared by the 정리 (tidy) screen.
 * Everything here is plain data so the renderer and tests can use it without Electron.
 */

/** Result of one hidden command. Same shape as quiet-process' QuietResult. */
export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs one command without a console window. Injected so core code stays testable. */
export type Runner = (command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<RunResult>

/** One checked-out copy of a repository. The first entry is the main folder. */
export interface WorktreeEntry {
  path: string
  branch: string
  /** True when git itself says the folder is gone and the entry can be pruned. */
  prunable: boolean
  /** True when the folder exists on disk. */
  exists: boolean
}

/** What is left behind in one git project. */
export interface RepoLeftover {
  repo: string
  /** Last folder name, for the row title. */
  name: string
  branch: string
  /** Files changed, added, removed, or unmerged and not yet committed. */
  changed: number
  /** New files git does not track yet. */
  untracked: number
  /** Commits not yet on the remote; -1 when there is no remote to compare with. */
  ahead: number
  behind: number
  /** True when the branch has somewhere to push to. */
  hasUpstream: boolean
  /** Extra checked-out folders other than the main one. Empty when this row is itself one of them. */
  worktrees: WorktreeEntry[]
  /** The main folder when this project is a checked-out copy of another one; '' otherwise. */
  partOf: string
  /** Epoch ms of the last commit; 0 when unknown. */
  lastCommitAt: number
  /** True when git could not be read here (not a repo, git missing, timeout). */
  failed: boolean
}

export type JobKind = 'cron' | 'systemd' | 'schtasks'

/** Something scheduled to run on its own. */
export interface ScheduledJob {
  kind: JobKind
  name: string
  /** Plain Korean schedule, e.g. "매일 9시" or "5분마다". */
  schedule: string
  command: string
  /** Epoch ms; 0 when unknown. */
  lastRunAt: number
  nextRunAt: number
  /** True when the system reports it as enabled/ready. */
  enabled: boolean
}

/** A long-running program with no window of its own (dev servers, watchers). */
export interface HeadlessProcess {
  pid: number
  ppid: number
  /** Short program name, e.g. "node" or "python". */
  name: string
  /** What it looks like it is doing, e.g. "vite dev" or "http.server 4798". */
  summary: string
  args: string
  /** Working folder when the OS tells us; '' otherwise. */
  cwd: string
  /** Epoch ms when it started; 0 when unknown. */
  startedAt: number
  rssBytes: number
  /** TCP ports this program (or a child of it) is listening on; empty when the OS did not say. */
  ports: number[]
}

/**
 * Two or more listed programs that are in each other's way: the same port, or the same
 * project folder started twice so the later one was pushed to another port.
 */
export interface PortOverlap {
  kind: 'same-port' | 'same-folder'
  /** The shared port for 'same-port'; 0 for 'same-folder'. */
  port: number
  /** The shared working folder for 'same-folder'; '' for 'same-port'. */
  cwd: string
  pids: number[]
}

export type HeavyKind = 'node_modules' | 'venv' | 'build' | 'cache' | 'temp' | 'worktree'

/** A folder that only takes up space and can be rebuilt or thrown away. */
export interface HeavyFolder {
  path: string
  kind: HeavyKind
  /** The project folder that owns it; '' for the system temp folder. */
  project: string
  bytes: number
  files: number
  /** True when counting stopped at the file budget, so bytes is a lower bound. */
  approx: boolean
  /** Epoch ms the owning project was last touched; 0 when unknown. */
  projectTouchedAt: number
}

export interface TidyReport {
  scannedAt: number
  /** Folders that were searched for projects. */
  roots: string[]
  repos: RepoLeftover[]
  jobs: ScheduledJob[]
  processes: HeadlessProcess[]
  /** Programs that share a port or a folder; each entry points at pids in `processes`. */
  overlaps: PortOverlap[]
  heavy: HeavyFolder[]
  /** Plain Korean notes about what could not be checked (no git, no crontab, ...). */
  notes: string[]
}
