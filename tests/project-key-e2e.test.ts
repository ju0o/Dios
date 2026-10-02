import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureApiKeyTable, listApiKeys, revealApiKey, type SecretLock } from '../src/core/api-keys/api-key-store'
import {
  DISCOVERY_SCRIPT,
  LOCAL_PLACE,
  approveCandidates,
  collectFromRoots,
  dismissCandidates,
  findingsFromRemote,
  parseRemoteProjects,
  withIds,
  CandidateMemory,
} from '../src/core/api-keys/project-discovery'

const SENTINEL = 'sk-proj-DIOS-FAKE-ONLY-12345678901234567890'
const IGNORE = 'sk-ant-DIOS-FAKE-ONLY-12345678901234567890'
const REMOTE = 'sk-proj-DIOS-FAKE-REMOTE-12345678901234567890'
const WORKTREE = 'sk-proj-DIOS-FAKE-WORKTREE-12345678901234567890'

const LOCK: SecretLock = {
  available: () => true,
  lock: (plain) => Buffer.from(plain, 'utf8').reverse().toString('base64'),
  unlock: (locked) => Buffer.from(locked, 'base64').reverse().toString('utf8'),
}

const trash: string[] = []

afterEach(() => {
  for (const dir of trash.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-key-e2e-'))
  trash.push(dir)
  return dir
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function keyCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }
  return row.n
}

function assertHidden(value: unknown): void {
  const packed = JSON.stringify(value)
  expect(packed.includes(SENTINEL)).toBe(false)
  expect(packed.includes(IGNORE)).toBe(false)
  expect(packed.includes(REMOTE)).toBe(false)
  expect(packed.includes(WORKTREE)).toBe(false)
}

describe('synthetic project key discovery', () => {
  it('finds a local fake project, shows only a mask, saves one key, and ignores the other', () => {
    const logs: string[] = []
    const write = (slot: 'log' | 'info' | 'warn' | 'error') => (...args: unknown[]) => {
      logs.push(args.map((item) => String(item)).join(' '))
      return slot
    }
    const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error }
    console.log = write('log')
    console.info = write('info')
    console.warn = write('warn')
    console.error = write('error')
    try {
      const root = tempDir()
      const repo = path.join(root, 'DIOS-Key-Test-Local')
      fs.mkdirSync(repo)
      fs.writeFileSync(path.join(repo, 'package.json'), '{}\n')
      fs.writeFileSync(path.join(repo, '.env.local'), `OPENAI_API_KEY=${SENTINEL}\nANTHROPIC_API_KEY=${IGNORE}\n`)
      const db = new Database(path.join(tempDir(), 'keys.db'))
      ensureApiKeyTable(db)
      const writes = db.totalChanges
      const collected = collectFromRoots([root], [], undefined, LOCAL_PLACE)
      expect(collected.projects.map((project) => project.name)).toContain('DIOS-Key-Test-Local')
      const memory = new CandidateMemory()
      memory.replacePlace(LOCAL_PLACE.placeId, withIds(collected.pending, (() => {
        let n = 0
        return () => `local-${++n}`
      })()))
      expect(db.totalChanges).toBe(writes)
      expect(keyCount(db)).toBe(0)
      const payload = { candidates: memory.list(), notes: [] as string[], message: '저장은 아래에서 고른 뒤에 해요.' }
      assertHidden(payload)
      expect(payload.candidates.map((card) => `${card.project} · ${card.placeName}`)).toContain('DIOS-Key-Test-Local · 이 컴퓨터')
      expect(payload.candidates.every((card) => card.masked.includes('••••'))).toBe(true)
      const saveId = payload.candidates.find((card) => card.label === 'OPENAI_API_KEY')?.id ?? ''
      const ignoreId = payload.candidates.find((card) => card.label === 'ANTHROPIC_API_KEY')?.id ?? ''
      const approved = approveCandidates(db, LOCK, memory, [saveId])
      expect(approved.saved).toBe(1)
      expect(keyCount(db)).toBe(1)
      expect(memory.peek([saveId])).toEqual([])
      expect(revealApiKey(db, LOCK, approved.savedIds[0]).key).toBe(SENTINEL)
      dismissCandidates(memory, [ignoreId])
      expect(keyCount(db)).toBe(1)
      expect(memory.list()).toEqual([])
      expect(listApiKeys(db).map((card) => card.label)).toEqual(['OPENAI_API_KEY'])
      assertHidden(listApiKeys(db))
      assertHidden(logs.join('\n'))
      const scan = fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')
      const body = scan.slice(scan.indexOf('async function runKeyScan'), scan.indexOf('async function runProjectDiscovery'))
      expect(body.includes('addApiKey')).toBe(false)
    } finally {
      console.log = originals.log
      console.info = originals.info
      console.warn = originals.warn
      console.error = originals.error
    }
  })

  it('runs the remote walker on a fake home and keeps the linked worktree out', () => {
    const home = tempDir()
    const projects = path.join(home, 'Projects')
    const repo = path.join(projects, 'DIOS-Key-Test-Remote')
    const worktree = path.join(projects, 'DIOS-Key-Test-Remote-wt')
    fs.mkdirSync(repo, { recursive: true })
    git(repo, ['init'])
    git(repo, ['config', 'user.email', 't@example.com'])
    git(repo, ['config', 'user.name', 'tester'])
    fs.writeFileSync(path.join(repo, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(repo, '.env.local'), `OPENAI_API_KEY=${REMOTE}\n`)
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'init'])
    git(repo, ['worktree', 'add', '--detach', worktree])
    fs.writeFileSync(path.join(worktree, '.env'), `OPENAI_API_KEY=${WORKTREE}\n`)
    const ran = spawnSync('python3', ['-'], {
      input: DISCOVERY_SCRIPT,
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    })
    if (ran.status !== 0) throw new Error('remote discovery script failed')
    const foundProjects = parseRemoteProjects(ran.stdout)
    expect(foundProjects.map((project) => project.name)).toContain('DIOS-Key-Test-Remote')
    expect(foundProjects.some((project) => project.name.includes('wt'))).toBe(false)
    const found = findingsFromRemote(foundProjects, { placeId: 'ssh:asus', placeName: 'asus (SSH)', placeKind: 'ssh' }, [])
    expect(found.pending.map((row) => row.finding.project)).toEqual(['DIOS-Key-Test-Remote'])
    const cards = withIds(found.pending, () => 'remote-1').map((row) => ({
      id: row.id,
      project: row.finding.project,
      placeId: row.placeId,
      placeName: row.placeName,
      placeKind: row.placeKind,
      masked: row.finding.key ? 'masked' : '',
    }))
    const memory = new CandidateMemory()
    memory.replacePlace('ssh:asus', withIds(found.pending, () => 'remote-1'))
    const screen = memory.list()
    expect(`${screen[0].project} · ${screen[0].placeName}`).toBe('DIOS-Key-Test-Remote · asus (SSH)')
    assertHidden(screen)
    assertHidden(cards)
    expect(JSON.stringify(found).includes(WORKTREE)).toBe(false)
  })

  it('keeps a synthetic main checkout and drops its linked worktree', () => {
    const root = tempDir()
    const repo = path.join(root, 'DIOS-Key-Test-Local')
    const worktree = path.join(root, 'DIOS-Key-Test-Local-wt')
    fs.mkdirSync(repo)
    git(repo, ['init'])
    git(repo, ['config', 'user.email', 't@example.com'])
    git(repo, ['config', 'user.name', 'tester'])
    fs.writeFileSync(path.join(repo, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(repo, '.env.local'), `OPENAI_API_KEY=${SENTINEL}\n`)
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'init'])
    git(repo, ['worktree', 'add', '--detach', worktree])
    fs.writeFileSync(path.join(worktree, '.env'), `OPENAI_API_KEY=${WORKTREE}\n`)
    const collected = collectFromRoots([root], [], undefined, LOCAL_PLACE)
    expect(collected.projects.map((project) => project.name)).toEqual(['DIOS-Key-Test-Local'])
    expect(collected.pending.map((row) => row.finding.key)).toEqual([SENTINEL])
    assertHidden(withIds(collected.pending, () => 'wt-1').map((row) => ({
      project: row.finding.project,
      placeName: row.placeName,
      masked: 'sk-••••••••7890',
      source: '.env.local',
    })))
  })

  it('has no hard-coded MainPC or ASUS machine names in discovery', () => {
    const discovery = fs.readFileSync(path.join(process.cwd(), 'src/core/api-keys/project-discovery.ts'), 'utf8')
    const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')
    expect(discovery.includes('computerLabel')).toBe(false)
    expect(discovery.includes('MainPC')).toBe(false)
    expect(discovery.includes("host === 'asus'")).toBe(false)
    expect(discovery.includes("host === 'main'")).toBe(false)
    expect(main.includes('computerLabel')).toBe(false)
    expect(main.includes('discoveryPlaces')).toBe(false)
  })
})
