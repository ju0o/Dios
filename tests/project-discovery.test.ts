import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CandidateMemory,
  DISCOVERY_SCRIPT,
  candidateLead,
  classifyGitPaths,
  collectFromRoots,
  discoverProjects,
  findingsFromRemote,
  normalizeOrigin,
  parseRemoteProjects,
  placeFailureNote,
  remotePlaces,
  toPublicCandidate,
  withIds,
  type GitProbe,
} from '../src/core/api-keys/project-discovery'

const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwxyz12'
const OTHER = 'sk-ant-abcdefghijklmnopqrstuvwxyz31'
const WORKTREE_SECRET = 'sk-proj-worktreeworktreeworktree99'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-disc-'))
  roots.push(dir)
  return dir
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function pendingPublic(dir: string, existing: Array<{ project: string; platform: string; label: string }> = []) {
  const collected = collectFromRoots([dir], existing)
  return {
    collected,
    cards: withIds(collected.pending, () => 'candidate-1').map(toPublicCandidate),
  }
}

describe('project discovery', () => {
  it('finds a normal git project and a folder that only has a project marker', () => {
    const root = tempDir()
    const repo = path.join(root, 'JuPlan')
    const marked = path.join(root, 'Notes')
    fs.mkdirSync(repo)
    fs.mkdirSync(marked)
    fs.writeFileSync(path.join(repo, 'package.json'), '{}')
    fs.writeFileSync(path.join(marked, 'requirements.txt'), 'pytest\n')
    git(repo, ['init'])
    const projects = discoverProjects([root, root])
    const names = projects.map((project) => project.name).sort()
    expect(names).toEqual(['JuPlan', 'Notes'])
    expect(projects.filter((project) => project.name === 'JuPlan')).toHaveLength(1)
    expect(projects.find((project) => project.name === 'Notes')?.kind).toBe('not-git')
  })

  it('drops a linked worktree and keeps the main checkout', () => {
    const root = tempDir()
    const repo = path.join(root, 'JuPlan')
    const worktree = path.join(root, 'JuPlan-wt')
    fs.mkdirSync(repo)
    git(repo, ['init'])
    git(repo, ['config', 'user.email', 't@example.com'])
    git(repo, ['config', 'user.name', 'tester'])
    fs.writeFileSync(path.join(repo, 'package.json'), '{}')
    fs.writeFileSync(path.join(repo, 'README'), 'x\n')
    fs.writeFileSync(path.join(repo, '.env'), `OPENAI_API_KEY=${SECRET}\n`)
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'init'])
    git(repo, ['worktree', 'add', '--detach', worktree])
    fs.writeFileSync(path.join(worktree, '.env'), `OPENAI_API_KEY=${WORKTREE_SECRET}\n`)
    const projects = discoverProjects([root])
    expect(projects.some((project) => project.path === fs.realpathSync(repo))).toBe(true)
    expect(projects.some((project) => project.path === fs.realpathSync(worktree))).toBe(false)
    const { collected, cards } = pendingPublic(root)
    expect(collected.pending.map((row) => row.finding.key)).toEqual([SECRET])
    expect(JSON.stringify(cards)).not.toContain(SECRET)
    expect(JSON.stringify(cards)).not.toContain(WORKTREE_SECRET)
  })

  it('keeps a folder when git cannot be checked', () => {
    const root = tempDir()
    const repo = path.join(root, 'Maybe')
    fs.mkdirSync(repo)
    fs.writeFileSync(path.join(repo, '.git'), 'gitdir: missing\n')
    fs.writeFileSync(path.join(repo, 'package.json'), '{}')
    const probe: GitProbe = () => null
    const projects = discoverProjects([root], probe)
    expect(projects.map((project) => project.kind)).toEqual(['unknown'])
  })

  it('labels the same origin with each place name', () => {
    expect(normalizeOrigin('https://github.com/ju0o/JuPlan.git')).toBe('https://github.com/ju0o/juplan')
    const row = {
      finding: {
        project: 'JuPlan',
        platform: 'OpenAI',
        label: 'OPENAI_API_KEY',
        key: SECRET,
        source: path.join('C:\\work', 'JuPlan', '.env'),
        root: 'C:\\work\\JuPlan',
      },
      placeKind: 'local' as const,
      projectPath: 'C:\\work\\JuPlan',
      origin: normalizeOrigin('https://github.com/ju0o/JuPlan.git'),
    }
    const here = toPublicCandidate({ ...row, id: 'a', placeId: 'local', placeName: '이 컴퓨터' })
    const ssh = toPublicCandidate({ ...row, id: 'b', placeId: 'ssh:asus', placeName: 'asus (SSH)', placeKind: 'ssh', projectPath: '/home/skkse12/JuPlan' })
    expect(`${here.project} · ${here.placeName}`).toBe('JuPlan · 이 컴퓨터')
    expect(`${ssh.project} · ${ssh.placeName}`).toBe('JuPlan · asus (SSH)')
    expect(ssh.projectPath).not.toBe(here.projectPath)
    expect(Object.keys(here).sort()).toEqual(['id', 'label', 'masked', 'placeId', 'placeKind', 'placeName', 'platform', 'project', 'projectPath', 'source'])
  })

  it('asks every remote place, and a missed place does not drop local keys', () => {
    const places = [
      { id: 'local', name: '이 컴퓨터', kind: 'local', target: '' },
      { id: 'ssh:asus', name: 'asus (SSH)', kind: 'ssh', target: 'asus' },
      { id: 'ssh:build', name: 'build (SSH)', kind: 'ssh', target: 'build' },
      { id: 'wsl:Ubuntu', name: 'Ubuntu (WSL)', kind: 'wsl', target: 'Ubuntu' },
    ]
    expect(remotePlaces(places).map((place) => place.name)).toEqual(['asus (SSH)', 'build (SSH)', 'Ubuntu (WSL)'])
    const memory = new CandidateMemory()
    memory.replacePlace('local', withIds([{
      finding: { project: 'JuPlan', platform: 'OpenAI', label: 'OPENAI_API_KEY', key: SECRET, source: '.env', root: '/JuPlan' },
      placeId: 'local',
      placeName: '이 컴퓨터',
      placeKind: 'local',
      projectPath: '/JuPlan',
      origin: '',
    }], () => 'local-1'))
    let notes: string[] = []
    try {
      parseRemoteProjects(`not json ${SECRET}`)
      memory.replacePlace('ssh:asus', [])
    } catch (error) {
      notes = [placeFailureNote('asus (SSH)')]
      expect(String((error as Error).message)).not.toContain(SECRET)
    }
    expect(notes).toEqual(['asus (SSH) 지금 연결할 수 없어요.'])
    expect(memory.list().map((card) => card.placeName)).toEqual(['이 컴퓨터'])
  })
})

describe('env candidates', () => {
  it('reads .env and .env.local, and skips examples, placeholders, and saved keys', () => {
    const root = tempDir()
    const repo = path.join(root, 'JuPlan')
    fs.mkdirSync(repo)
    fs.writeFileSync(path.join(repo, 'package.json'), '{}')
    fs.writeFileSync(path.join(repo, '.env'), `OPENAI_API_KEY=${SECRET}\nAPP_NAME=hello\n`)
    fs.writeFileSync(path.join(repo, '.env.local'), `ANTHROPIC_API_KEY=${OTHER}\nOPENAI_API_KEY=changeme-please\n`)
    fs.writeFileSync(path.join(repo, '.env.example'), `OPENAI_API_KEY=${SECRET}\n`)
    fs.writeFileSync(path.join(repo, '.env.sample'), `OPENAI_API_KEY=${SECRET}\n`)
    const { collected, cards } = pendingPublic(root)
    expect(collected.pending.map((row) => row.finding.label).sort()).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'])
    expect(cards.map((card) => card.source).sort()).toEqual(['.env', '.env.local'])
    const again = collectFromRoots([root], [{ project: 'JuPlan', platform: 'OpenAI', label: 'OPENAI_API_KEY' }])
    expect(again.pending.map((row) => row.finding.label)).toEqual(['ANTHROPIC_API_KEY'])
    expect(again.kept).toBe(1)
  })

  it('reports no key when the env file has nothing that looks like one', () => {
    const root = tempDir()
    const repo = path.join(root, 'Empty')
    fs.mkdirSync(repo)
    fs.writeFileSync(path.join(repo, 'package.json'), '{}')
    fs.writeFileSync(path.join(repo, '.env'), 'APP_NAME=hello\n')
    const { collected } = pendingPublic(root)
    expect(collected.pending).toEqual([])
    expect(candidateLead(1, 0, 0)).toContain('새로 저장할 API 키는 없어요')
  })
})

describe('secret boundary and approval', () => {
  it('sends only a masked card, and ignore or a second save keeps nothing new', () => {
    const memory = new CandidateMemory()
    const rows = withIds([
      {
        finding: { project: 'JuPlan', platform: 'OpenAI', label: 'OPENAI_API_KEY', key: SECRET, source: path.join('/tmp', 'JuPlan', '.env.local'), root: '/tmp/JuPlan' },
        placeId: 'local',
        placeName: '이 컴퓨터',
        placeKind: 'local',
        projectPath: '/tmp/JuPlan',
        origin: 'https://github.com/ju0o/juplan',
      },
      {
        finding: { project: 'JuPlan', platform: 'Anthropic (Claude)', label: 'ANTHROPIC_API_KEY', key: OTHER, source: path.join('/tmp', 'JuPlan', '.env'), root: '/tmp/JuPlan' },
        placeId: 'local',
        placeName: '이 컴퓨터',
        placeKind: 'local',
        projectPath: '/tmp/JuPlan',
        origin: '',
      },
    ], (() => {
      let n = 0
      return () => `candidate-${++n}`
    })())
    memory.replacePlace('local', rows)
    const cards = memory.list()
    const packed = JSON.stringify(cards)
    expect(packed).not.toContain(SECRET)
    expect(packed).not.toContain(OTHER)
    expect(cards[0]).not.toHaveProperty('key')
    expect(cards[0].masked.startsWith('sk-')).toBe(true)
    expect(cards[0].masked).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(cards.map((card) => card.source).sort()).toEqual(['.env', '.env.local'])
    const one = memory.peek(['candidate-1'])
    expect(one).toHaveLength(1)
    expect(one[0].finding.key).toBe(SECRET)
    memory.remove(one.map((row) => row.id))
    expect(memory.peek(['candidate-1'])).toEqual([])
    expect(memory.list()).toHaveLength(1)
    memory.remove(memory.list().map((card) => card.id))
    expect(memory.list()).toEqual([])
    expect(memory.peek(['candidate-1', 'candidate-2'])).toEqual([])
  })

  it('drops a linked worktree that a remote computer reported, without keeping its secret', () => {
    const found = findingsFromRemote([
      {
        path: '/home/skkse12/JuPlan',
        name: 'JuPlan',
        gitDir: '/home/skkse12/JuPlan/.git',
        commonDir: '/home/skkse12/JuPlan/.git',
        origin: 'https://github.com/ju0o/JuPlan.git',
        envFiles: [{ name: '.env.local', text: `OPENAI_API_KEY=${SECRET}\n` }, { name: '.env.example', text: `OPENAI_API_KEY=${SECRET}\n` }],
      },
      {
        path: '/home/skkse12/JuPlan-wt',
        name: 'JuPlan-wt',
        gitDir: '/home/skkse12/JuPlan/.git/worktrees/JuPlan-wt',
        commonDir: '/home/skkse12/JuPlan/.git',
        origin: 'https://github.com/ju0o/JuPlan.git',
        envFiles: [{ name: '.env', text: `OPENAI_API_KEY=${WORKTREE_SECRET}\n` }],
      },
    ], { placeId: 'ssh:asus', placeName: 'asus (SSH)', placeKind: 'ssh' }, [])
    expect(found.linkedSkipped).toBe(1)
    expect(found.projectsFound).toBe(1)
    expect(found.pending).toHaveLength(1)
    expect(JSON.stringify(toPublicCandidate({ ...found.pending[0], id: 'remote-1' }))).not.toContain(SECRET)
    expect(JSON.stringify(found.pending)).toContain(SECRET)
    expect(JSON.stringify(found)).not.toContain(WORKTREE_SECRET)
  })

  it('does not call Ollama from this feature', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/core/api-keys/project-discovery.ts'), 'utf8')
    expect(source.toLowerCase()).not.toContain('ollama')
    expect(DISCOVERY_SCRIPT.toLowerCase()).not.toContain('ollama')
  })
})

describe('git path kinds', () => {
  it('tells a main checkout, a linked worktree, a submodule, and an unknown apart', () => {
    expect(classifyGitPaths('/repo/.git', '/repo/.git', '/repo')).toBe('main')
    expect(classifyGitPaths('.git', '.git', '/repo')).toBe('main')
    expect(classifyGitPaths('/repo/.git/worktrees/wt', '/repo/.git', '/work/wt')).toBe('linked')
    expect(classifyGitPaths('/repo/.git/modules/sub', '/repo/.git/modules/sub', '/repo/sub')).toBe('main')
    expect(classifyGitPaths('', '', '/repo')).toBe('unknown')
  })
})
