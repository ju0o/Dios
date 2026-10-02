import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import { isProjectDirectory, isSkippedEnvName, parseEnv, platformFor, scanEnvRoots, type EnvFinding } from './env-scan'
import { maskSecret, type PublicCandidate } from './api-key-text'
import { addApiKey, type SecretLock } from './api-key-store'

/** main checkout, a linked worktree, or git could not be read. */
export type GitKind = 'main' | 'linked' | 'unknown'

export interface GitProbeResult {
  gitDir: string
  commonDir: string
  origin: string
}

/** Reads git metadata for one folder. Null when git is not a repo there. */
export type GitProbe = (dir: string) => GitProbeResult | null

/** One computer from the existing place list. The screen shows `placeName` as it is. */
export interface DiscoveryPlace {
  placeId: string
  placeName: string
  placeKind: 'local' | 'ssh' | 'wsl'
}

/** The place list's local row, used when no place list is passed in. */
export const LOCAL_PLACE: DiscoveryPlace = { placeId: 'local', placeName: '이 컴퓨터', placeKind: 'local' }

export interface DiscoveredProject {
  path: string
  name: string
  kind: GitKind | 'not-git'
  origin: string
  placeName: string
}

/** A key already in the store. Same project + platform + label is not offered again. */
export interface KeySpot {
  project: string
  platform: string
  label: string
}

/** Raw candidate. Stays in the main process. The secret is `finding.key`. */
export interface StoredCandidate {
  id: string
  finding: EnvFinding
  placeId: string
  placeName: string
  placeKind: 'local' | 'ssh' | 'wsl'
  projectPath: string
  origin: string
}

export type { PublicCandidate }

export interface RemoteEnvFile {
  name: string
  text: string
}

export interface RemoteProject {
  path: string
  name: string
  gitDir: string
  commonDir: string
  origin: string
  envFiles: RemoteEnvFile[]
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', 'target', '.cache', 'coverage', '.idea', '.vscode'])
const MAX_DEPTH = 5
const MAX_PROJECTS = 80

/**
 * Linked worktree when the git dir sits under the common dir's `worktrees` folder.
 * The same git dir and common dir is the main checkout, including a submodule.
 * Empty answers stay unknown so we do not drop a folder we could not check.
 */
export function classifyGitPaths(gitDir: string, commonDir: string, cwd: string): GitKind {
  const git = gitDir.trim()
  const common = commonDir.trim()
  if (!git || !common) return 'unknown'
  const absGit = path.resolve(cwd, git)
  const absCommon = path.resolve(cwd, common)
  if (samePath(absGit, absCommon)) return 'main'
  const rel = path.relative(absCommon, absGit)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return 'main'
  return rel.split(/[\\/]/).includes('worktrees') ? 'linked' : 'main'
}

/** Drop `.git` and a trailing slash so the same remote matches on two computers. */
export function normalizeOrigin(url: string): string {
  return url.trim().replace(/\.git$/i, '').replace(/[/\\]+$/, '').toLowerCase()
}

/** Copy a place-list row into the fields a candidate carries. */
export function asDiscoveryPlace(place: { id: string; name: string; kind: 'local' | 'ssh' | 'wsl' }): DiscoveryPlace {
  return { placeId: place.id, placeName: place.name, placeKind: place.kind }
}

/** Every SSH or WSL place. A new host in the place list is included without a code change. */
export function remotePlaces<T extends { kind: string }>(places: T[]): T[] {
  return places.filter((place) => place.kind === 'ssh' || place.kind === 'wsl')
}

/** One Korean line when a remote place cannot be reached. The rest of the scan still finishes. */
export function placeFailureNote(placeName: string): string {
  return `${placeName} 지금 연결할 수 없어요.`
}

/** Headline for the candidate card. Empty when there is nothing new to say. */
export function candidateLead(projectsFound: number, keyCount: number, projectsWithKeys: number): string {
  if (!keyCount) {
    if (!projectsFound) return ''
    return `프로젝트 ${projectsFound}곳을 찾았는데, 새로 저장할 API 키는 없어요.`
  }
  return `새 프로젝트 ${projectsFound}곳을 찾았고, 그중 ${projectsWithKeys}곳에서 새 API 키 ${keyCount}개를 찾았어요.`
}

/** Ask git. A missing repo or a failed git returns null (unknown, not a linked worktree). */
export function probeGit(dir: string): GitProbeResult | null {
  const run = (args: string[]): string => {
    try {
      return execFileSync('git', ['-C', dir, ...args], {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return ''
    }
  }
  const gitDir = run(['rev-parse', '--git-dir'])
  const commonDir = run(['rev-parse', '--git-common-dir'])
  if (!gitDir && !commonDir) return null
  return { gitDir, commonDir, origin: run(['remote', 'get-url', 'origin']) }
}

/** True only when git says this folder is a linked worktree. Unknown stays false. */
export function isLinkedWorktree(dir: string, probe: GitProbe = probeGit): boolean {
  const gitPath = path.join(dir, '.git')
  if (!fs.existsSync(gitPath)) return false
  const info = probe(dir)
  if (!info) return false
  return classifyGitPaths(info.gitDir, info.commonDir, dir) === 'linked'
}

/**
 * Project folders under the given roots.
 * Linked worktrees are skipped and not walked into. Depth stays at the env scan limit.
 */
export function discoverProjects(roots: string[], probe: GitProbe = probeGit, placeName = ''): DiscoveredProject[] {
  const found: DiscoveredProject[] = []
  const seen = new Set<string>()

  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || found.length >= MAX_PROJECTS) return
    let real = dir
    try {
      real = fs.realpathSync(dir)
      if (!fs.statSync(real).isDirectory()) return
    } catch {
      return
    }
    if (seen.has(real)) return
    seen.add(real)

    const gitPath = path.join(real, '.git')
    let kind: DiscoveredProject['kind'] = 'not-git'
    let origin = ''
    if (fs.existsSync(gitPath)) {
      const info = probe(real)
      if (!info || (!info.gitDir && !info.commonDir)) kind = 'unknown'
      else {
        kind = classifyGitPaths(info.gitDir, info.commonDir, real)
        origin = normalizeOrigin(info.origin)
      }
      if (kind === 'linked') return
    }
    if (isProjectDirectory(real)) {
      found.push({ path: real, name: path.basename(real), kind, origin, placeName })
    }
    if (depth === MAX_DEPTH) return
    for (const child of childDirs(real)) visit(child, depth + 1)
  }

  for (const root of roots) visit(path.resolve(root), 0)
  return found
}

/** Scan roots, drop linked worktrees, and keep only keys that are not already stored. */
export function collectFromRoots(
  roots: string[],
  existing: KeySpot[],
  probe: GitProbe = probeGit,
  place: DiscoveryPlace = LOCAL_PLACE,
): { projects: DiscoveredProject[]; pending: Array<Omit<StoredCandidate, 'id'>>; kept: number; scan: ReturnType<typeof scanEnvRoots> } {
  const projects = discoverProjects(roots, probe, place.placeName)
  const scan = scanEnvRoots(roots, { skipDir: (dir) => isLinkedWorktree(dir, probe) })
  const pending: Array<Omit<StoredCandidate, 'id'>> = []
  let kept = 0
  for (const finding of scan.findings) {
    const home = nearestProject(projects, finding.source)
    const named: EnvFinding = home ? { ...finding, project: home.name } : finding
    if (alreadyStored(named, existing)) {
      kept += 1
      continue
    }
    pending.push({
      finding: named,
      placeId: place.placeId,
      placeName: place.placeName,
      placeKind: place.placeKind,
      projectPath: home?.path ?? finding.root,
      origin: home?.origin ?? '',
    })
  }
  return { projects, pending: dedupePending(pending), kept, scan }
}

/** Turn a remote discovery payload into candidates. Linked worktrees are dropped here too. */
export function findingsFromRemote(
  projects: RemoteProject[],
  place: DiscoveryPlace,
  existing: KeySpot[],
): { projectsFound: number; linkedSkipped: number; pending: Array<Omit<StoredCandidate, 'id'>>; kept: number } {
  let projectsFound = 0
  let linkedSkipped = 0
  let kept = 0
  const pending: Array<Omit<StoredCandidate, 'id'>> = []
  const seen = new Set<string>()
  for (const project of projects) {
    const kind = classifyGitPaths(project.gitDir, project.commonDir, project.path || '.')
    if (kind === 'linked') {
      linkedSkipped += 1
      continue
    }
    const folder = project.path || project.name
    if (!folder || seen.has(folder)) continue
    seen.add(folder)
    projectsFound += 1
    const origin = normalizeOrigin(project.origin)
    for (const file of project.envFiles) {
      if (isSkippedEnvName(file.name)) continue
      for (const entry of parseEnv(file.text)) {
        const platform = platformFor(entry.name, entry.value)
        if (!platform) continue
        const finding: EnvFinding = {
          project: project.name || path.basename(folder),
          platform,
          label: entry.name,
          key: entry.value,
          source: file.name,
          root: folder,
        }
        if (alreadyStored(finding, existing)) {
          kept += 1
          continue
        }
        pending.push({
          finding,
          placeId: place.placeId,
          placeName: place.placeName,
          placeKind: place.placeKind,
          projectPath: folder,
          origin,
        })
      }
    }
  }
  return { projectsFound, linkedSkipped, pending: dedupePending(pending), kept }
}

/** Read the remote JSON without throwing the raw text back to logs. */
export function parseRemoteProjects(raw: string): RemoteProject[] {
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('remote discovery had no result')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start))
  } catch {
    throw new Error('remote discovery had no result')
  }
  const projects = (parsed as { projects?: unknown })?.projects
  if (!Array.isArray(projects)) throw new Error('remote discovery had no result')
  const out: RemoteProject[] = []
  for (const item of projects) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const envFiles: RemoteEnvFile[] = []
    if (Array.isArray(row.envFiles)) {
      for (const file of row.envFiles) {
        if (!file || typeof file !== 'object') continue
        const env = file as Record<string, unknown>
        const name = typeof env.name === 'string' ? path.basename(env.name) : ''
        const text = typeof env.text === 'string' ? env.text.slice(0, 200_000) : ''
        if (!name || isSkippedEnvName(name)) continue
        envFiles.push({ name, text })
      }
    }
    out.push({
      path: typeof row.path === 'string' ? row.path : '',
      name: typeof row.name === 'string' ? row.name : '',
      gitDir: typeof row.gitDir === 'string' ? row.gitDir : '',
      commonDir: typeof row.commonDir === 'string' ? row.commonDir : '',
      origin: typeof row.origin === 'string' ? row.origin : '',
      envFiles,
    })
  }
  return out
}

/** Attach ids. The caller supplies them so tests stay deterministic. */
export function withIds(rows: Array<Omit<StoredCandidate, 'id'>>, idOf: () => string): StoredCandidate[] {
  return rows.map((row) => ({ ...row, id: idOf() }))
}

/** Screen copy of one candidate. The full secret is not copied. */
export function toPublicCandidate(row: StoredCandidate): PublicCandidate {
  return {
    id: row.id,
    project: row.finding.project,
    placeId: row.placeId,
    placeName: row.placeName,
    placeKind: row.placeKind,
    platform: row.finding.platform,
    label: row.finding.label,
    masked: maskSecret(row.finding.key),
    source: path.basename(row.finding.source),
    projectPath: row.projectPath,
  }
}

/** In-memory candidates. They disappear when the process exits. No database. */
export class CandidateMemory {
  private rows = new Map<string, StoredCandidate>()

  /** Replace every candidate that came from one computer, then add the new ones. */
  replacePlace(placeId: string, next: StoredCandidate[]): void {
    for (const [id, row] of this.rows) {
      if (row.placeId === placeId) this.rows.delete(id)
    }
    for (const row of next) this.rows.set(row.id, row)
  }

  list(): PublicCandidate[] {
    return [...this.rows.values()].map(toPublicCandidate)
  }

  peek(ids: string[]): StoredCandidate[] {
    const out: StoredCandidate[] = []
    for (const id of ids) {
      const row = this.rows.get(id)
      if (row) out.push(row)
    }
    return out
  }

  remove(ids: string[]): void {
    for (const id of ids) this.rows.delete(id)
  }
}

/** How many candidate groups actually hold a new key. */
export function projectsWithKeys(rows: Array<{ finding: { project: string }; placeId: string }>): number {
  return new Set(rows.map((row) => `${row.placeId}\n${row.finding.project}`)).size
}

/**
 * Save the chosen candidates with the existing key store, then drop them from memory.
 * A key already stored at the same spot is left as it is.
 */
export function approveCandidates(db: Database.Database, lock: SecretLock, memory: CandidateMemory, ids: string[]): { saved: number; savedIds: string[] } {
  const savedIds: string[] = []
  const done: string[] = []
  for (const row of memory.peek(ids)) {
    const result = addApiKey(db, lock, {
      project: row.finding.project,
      platform: row.finding.platform,
      label: row.finding.label,
      key: row.finding.key,
      note: '',
    }, row.finding.source)
    if (result.ok) {
      savedIds.push(result.id)
      done.push(row.id)
    } else if (result.message.includes('이미')) {
      done.push(row.id)
    }
  }
  memory.remove(done)
  return { saved: savedIds.length, savedIds }
}

/** Forget candidates without writing them. */
export function dismissCandidates(memory: CandidateMemory, ids: string[]): void {
  memory.remove(ids)
}

/**
 * Remote walker. Prints one JSON object. Env text stays in that object for the main process.
 * Linked worktrees are omitted so their secrets never leave that computer.
 */
export const DISCOVERY_SCRIPT = `
import json, os, subprocess, sys
SKIP = {"node_modules", ".git", "dist", "dist-electron", "release", "build", "out", ".next", ".venv", "venv", "__pycache__", "target", ".cache", "coverage", ".idea", ".vscode"}
MARKERS = ("package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", ".git", "pom.xml", "build.gradle", "composer.json", "Gemfile")
MAX_DEPTH = 5
MAX_PROJECTS = 80
MAX_FILES = 80
files_read = 0

def git_line(folder, *args):
    try:
        out = subprocess.run(["git", "-C", folder, *args], capture_output=True, text=True, timeout=4)
        if out.returncode != 0:
            return ""
        return out.stdout.strip()
    except Exception:
        return ""

def kind_of(git_dir, common, cwd):
    if not git_dir or not common:
        return "unknown"
    git_dir = os.path.abspath(os.path.join(cwd, git_dir))
    common = os.path.abspath(os.path.join(cwd, common))
    if os.path.normcase(git_dir) == os.path.normcase(common):
        return "main"
    rel = os.path.relpath(git_dir, common)
    if rel.startswith("..") or os.path.isabs(rel):
        return "main"
    if "worktrees" in rel.split(os.sep):
        return "linked"
    return "main"

def is_env(name):
    if name != ".env" and not name.startswith(".env."):
        return False
    lower = name.lower()
    for tail in (".example", ".sample", ".template", ".dist", ".default", ".defaults"):
        if lower.endswith(tail):
            return False
    return True

def read_envs(folder):
    global files_read
    found = []
    try:
        names = os.listdir(folder)
    except Exception:
        return found
    for name in names:
        if files_read >= MAX_FILES or not is_env(name):
            continue
        full = os.path.join(folder, name)
        try:
            if not os.path.isfile(full) or os.path.getsize(full) > 200000:
                continue
            with open(full, "r", encoding="utf-8", errors="replace") as handle:
                text = handle.read(200000)
        except Exception:
            continue
        files_read += 1
        found.append({"name": name, "text": text})
    return found

def walk(folder, depth, out, seen):
    if depth > MAX_DEPTH or len(out) >= MAX_PROJECTS:
        return
    try:
        real = os.path.realpath(folder)
    except Exception:
        return
    if real in seen or not os.path.isdir(real):
        return
    seen.add(real)
    git_dir = ""
    common = ""
    origin = ""
    kind = "not-git"
    if os.path.exists(os.path.join(real, ".git")):
        git_dir = git_line(real, "rev-parse", "--git-dir")
        common = git_line(real, "rev-parse", "--git-common-dir")
        origin = git_line(real, "remote", "get-url", "origin")
        kind = kind_of(git_dir, common, real)
        if kind == "linked":
            return
    marker = False
    for name in MARKERS:
        if os.path.exists(os.path.join(real, name)):
            marker = True
            break
    if marker:
        out.append({
            "path": real,
            "name": os.path.basename(real),
            "gitDir": git_dir,
            "commonDir": common,
            "origin": origin,
            "envFiles": read_envs(real),
        })
    if depth == MAX_DEPTH:
        return
    try:
        children = os.listdir(real)
    except Exception:
        return
    for name in children:
        if name in SKIP or (name.startswith(".") and name != ".config"):
            continue
        child = os.path.join(real, name)
        if os.path.isdir(child) and not os.path.islink(child):
            walk(child, depth + 1, out, seen)

def main():
    home = os.path.expanduser("~")
    rels = ["src", "Projects", "projects", "dev", "code", "work", os.path.join("Desktop", "Projects"), os.path.join("Documents", "Projects")]
    roots = []
    for rel in rels:
        full = os.path.join(home, rel)
        if os.path.isdir(full):
            roots.append(full)
    projects = []
    seen = set()
    for root in roots:
        walk(root, 0, projects, seen)
    sys.stdout.write(json.dumps({"ok": True, "projects": projects}))

if __name__ == "__main__":
    main()
`

function samePath(left: string, right: string): boolean {
  return path.normalize(left).replace(/[\\/]+$/, '').toLowerCase() === path.normalize(right).replace(/[\\/]+$/, '').toLowerCase()
}

function childDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => !SKIP_DIRS.has(name) && !(name.startsWith('.') && name !== '.config'))
      .map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

function nearestProject(projects: DiscoveredProject[], file: string): DiscoveredProject | undefined {
  const dir = path.dirname(file)
  let best: DiscoveredProject | undefined
  for (const project of projects) {
    if (dir === project.path || dir.startsWith(project.path + path.sep)) {
      if (!best || project.path.length > best.path.length) best = project
    }
  }
  return best
}

function alreadyStored(finding: EnvFinding, existing: KeySpot[]): boolean {
  return existing.some((row) => row.project === finding.project && row.platform === finding.platform && row.label === finding.label)
}

function dedupePending(rows: Array<Omit<StoredCandidate, 'id'>>): Array<Omit<StoredCandidate, 'id'>> {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const id = `${row.placeId}\n${row.finding.project}\n${row.finding.platform}\n${row.finding.label}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
