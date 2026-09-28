import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import remoteScript from '../src/core/skill-board/remote.py?raw'
import Database from 'better-sqlite3'
import { cursorEntries, parseClaudeLines, parseCodexLines, projectFromFile, projectOf, readCachedUsage, readLocalUsage, usageCachePath, type UsageEntry } from '../src/core/agent-monitor/local-logs'
import { costOf, priceFor } from '../src/core/agent-monitor/pricing'
import { buildUsageScreen, dollars, projectName, todaySentence, tokens, trendLine, weekGraph } from '../src/core/agent-monitor/usage-summary'

/** A Cursor tracking database with the one table the reader looks at. */
function writeCursorDb(home: string, rows: Array<{ timestamp: number; model: string; fileName: string; requestId: string; conversationId: string }>): void {
  const dir = path.join(home, '.cursor', 'ai-tracking')
  fs.mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, 'ai-code-tracking.db'))
  db.exec('CREATE TABLE ai_code_hashes (hash TEXT PRIMARY KEY, source TEXT NOT NULL, fileExtension TEXT, fileName TEXT, requestId TEXT, conversationId TEXT, timestamp INTEGER, model TEXT, createdAt INTEGER NOT NULL)')
  const insert = db.prepare('INSERT INTO ai_code_hashes (hash, source, fileName, requestId, conversationId, timestamp, model, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  rows.forEach((row, index) => insert.run(`h${index}`, 'cli', row.fileName, row.requestId, row.conversationId, row.timestamp, row.model, row.timestamp))
  db.close()
}

/** One assistant line in the shape Claude Code writes. */
function claudeLine(id: string, model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0, stamp = '2026-09-28T03:00:00.000Z', cwd = 'D:\\Work\\Agent-Relay'): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${id}-${Math.random()}`,
    requestId: `req_${id}`,
    timestamp: stamp,
    cwd,
    message: { id, model, role: 'assistant', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite } },
  })
}

function codexTotal(input: number, cached: number, output: number, stamp: string): string {
  return JSON.stringify({ timestamp: stamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output }, last_token_usage: {} } } })
}

const CODEX_META = JSON.stringify({ timestamp: '2026-09-28T01:00:00.000Z', type: 'session_meta', payload: { id: 's1', cwd: '/home/me/Desktop/Projects/JuCeipt', model_provider: 'openai' } })
const CODEX_TURN = JSON.stringify({ timestamp: '2026-09-28T01:00:01.000Z', type: 'turn_context', payload: { cwd: '/home/me/Desktop/Projects/JuCeipt', model: 'gpt-5.6-luna' } })

describe('Claude Code log lines', () => {
  it('counts a message once even when its blocks repeat the usage', () => {
    const text = [
      claudeLine('msg_1', 'claude-sonnet-5', 1000, 200),
      claudeLine('msg_1', 'claude-sonnet-5', 1000, 200),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      claudeLine('msg_2', 'claude-opus-5', 10, 20, 5000, 300),
      'not json',
    ].join('\n')
    const entries = parseClaudeLines(text)
    expect(entries).toHaveLength(2)
    const sonnet = entries.find((entry) => entry.model === 'claude-sonnet-5')!
    expect(sonnet.input).toBe(1000)
    expect(sonnet.output).toBe(200)
    expect(sonnet.project).toBe('Agent-Relay')
    const opus = entries.find((entry) => entry.model === 'claude-opus-5')!
    expect(opus.cacheRead).toBe(5000)
    expect(opus.cacheWrite).toBe(300)
  })

  it('skips synthetic messages and merges the same day, project, and model', () => {
    const text = [
      claudeLine('a', 'claude-sonnet-5', 100, 10),
      claudeLine('b', 'claude-sonnet-5', 100, 10),
      claudeLine('c', '<synthetic>', 100, 10),
    ].join('\n')
    const entries = parseClaudeLines(text)
    expect(entries).toHaveLength(1)
    expect(entries[0].input).toBe(200)
  })
})

describe('Codex log lines', () => {
  it('turns the running total into per-moment use and keeps cached input apart', () => {
    const text = [
      CODEX_META,
      CODEX_TURN,
      codexTotal(1000, 400, 100, '2026-09-28T01:10:00.000Z'),
      codexTotal(3000, 1400, 250, '2026-09-28T01:20:00.000Z'),
      codexTotal(3000, 1400, 250, '2026-09-28T01:21:00.000Z'),
    ].join('\n')
    const entries = parseCodexLines(text)
    expect(entries).toHaveLength(1)
    const only = entries[0]
    expect(only.tool).toBe('codex')
    expect(only.model).toBe('gpt-5.6-luna')
    expect(only.project).toBe('JuCeipt')
    // 3000 input in total, 1400 of it cached: 1600 fresh input, 1400 cache reads, 250 output.
    expect(only.input).toBe(1600)
    expect(only.cacheRead).toBe(1400)
    expect(only.output).toBe(250)
  })

  it('lands a session that crosses midnight on both days', () => {
    const text = [
      CODEX_META,
      codexTotal(100, 0, 10, '2026-09-27T14:00:00.000Z'),
      codexTotal(300, 0, 30, '2026-09-28T14:00:00.000Z'),
    ].join('\n')
    const entries = parseCodexLines(text)
    expect(entries.map((entry) => entry.day)).toHaveLength(2)
    expect(new Set(entries.map((entry) => entry.day)).size).toBe(2)
  })
})

describe('Cursor tracking rows', () => {
  const stamp = new Date(2026, 8, 28, 10, 0, 0).getTime()
  it('counts distinct requests and chats per day, project, and model', () => {
    const entries = cursorEntries([
      { timestamp: stamp, model: 'auto-smart', fileName: '/home/me/Desktop/Projects/Team/JuCeipt/package.json', requestId: 'r1', conversationId: 'c1' },
      { timestamp: stamp, model: 'auto-smart', fileName: '/home/me/Desktop/Projects/Team/JuCeipt/src/a.ts', requestId: 'r1', conversationId: 'c1' },
      { timestamp: stamp, model: 'auto-smart', fileName: '/home/me/Desktop/Projects/Team/JuCeipt/src/b.ts', requestId: 'r2', conversationId: 'c1' },
      { timestamp: stamp + 60_000, model: 'glm-5.2', fileName: 'C:\\Users\\user\\src\\Dios\\electron\\main.ts', requestId: 'r3', conversationId: 'c2' },
      { timestamp: stamp, model: null, fileName: null, requestId: null, conversationId: null },
    ])
    expect(entries).toHaveLength(2)
    const juceipt = entries.find((entry) => entry.project === 'JuCeipt')!
    expect(juceipt.tool).toBe('cursor')
    expect(juceipt.count).toBe(2)
    expect(juceipt.chats).toBe(1)
    expect(juceipt.input).toBe(0)
    expect(entries.find((entry) => entry.project === 'Dios')?.model).toBe('glm-5.2')
  })

  it('finds the project folder in ordinary, grouped, and worktree paths', () => {
    expect(projectFromFile('/home/me/Desktop/Projects/Team/JuCeipt/src/a.ts')).toBe('JuCeipt')
    expect(projectFromFile('/home/me/Desktop/Projects/Core/Dios/electron/main.ts')).toBe('Dios')
    expect(projectFromFile('C:\\Users\\user\\src\\Dios\\electron\\main.ts')).toBe('Dios')
    expect(projectFromFile('/home/me/.local/share/AgentRelay/data/execution-worktrees/juplan/juplan-studio-123/src/x.ts')).toBe('juplan')
    expect(projectFromFile('/home/me/Dios/a.ts')).toBe('Dios')
    expect(projectFromFile('/home/me/.config/opencode/skills/x.md')).toBe('opencode')
    expect(projectFromFile('')).toBe('')
    expect(projectOf('/home/me/.local/share/AgentRelay/data/execution-worktrees/juplan/juplan-studio-123')).toBe('juplan')
    expect(projectOf('D:\\Work\\Agent-Relay')).toBe('Agent-Relay')
  })
})

describe('reading a home folder with a cache', () => {
  it('parses once, then reuses the cache, drops files that vanish, and adds Cursor counts', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-usage-'))
    const claudeDir = path.join(home, '.claude', 'projects', 'D--Work')
    const codexDir = path.join(home, '.codex', 'sessions', '2026', '09', '28')
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.mkdirSync(codexDir, { recursive: true })
    const claudeFile = path.join(claudeDir, 'one.jsonl')
    fs.writeFileSync(claudeFile, claudeLine('m1', 'claude-sonnet-5', 500, 50) + '\n')
    fs.writeFileSync(path.join(codexDir, 'rollout-1.jsonl'), [CODEX_META, CODEX_TURN, codexTotal(1000, 0, 100, '2026-09-28T01:10:00.000Z')].join('\n') + '\n')
    writeCursorDb(home, [{ timestamp: Date.now(), model: 'auto-smart', fileName: '/home/me/Projects/Dios/a.ts', requestId: 'r1', conversationId: 'c1' }])

    const first = readLocalUsage(home)
    expect(first).toHaveLength(3)
    expect(first.find((entry) => entry.tool === 'cursor')?.count).toBe(1)
    expect(fs.existsSync(usageCachePath(home))).toBe(true)

    // The badge at start uses only the file cache; Cursor's database is not opened then.
    const cached = readCachedUsage(home)
    expect(cached).toHaveLength(2)

    fs.rmSync(claudeFile)
    const second = readLocalUsage(home)
    expect(second.filter((entry) => entry.tool !== 'cursor')).toHaveLength(1)
    expect(second.find((entry) => entry.tool !== 'cursor')?.tool).toBe('codex')
    fs.rmSync(home, { recursive: true, force: true })
  })

  const hasPython = (() => {
    try {
      execFileSync('python3', ['--version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()

  it.skipIf(!hasPython)('the Python helper for other computers gives the same entries', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-usage-py-'))
    const claudeDir = path.join(home, '.claude', 'projects', 'D--Work')
    const codexDir = path.join(home, '.codex', 'sessions', '2026', '09', '28')
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.mkdirSync(codexDir, { recursive: true })
    fs.writeFileSync(path.join(claudeDir, 'one.jsonl'), [claudeLine('m1', 'claude-sonnet-5', 500, 50), claudeLine('m1', 'claude-sonnet-5', 500, 50), claudeLine('m2', 'claude-opus-5', 10, 20, 5000, 300)].join('\n') + '\n')
    fs.writeFileSync(path.join(codexDir, 'rollout-1.jsonl'), [CODEX_META, CODEX_TURN, codexTotal(1000, 400, 100, '2026-09-28T01:10:00.000Z'), codexTotal(3000, 1400, 250, '2026-09-28T01:20:00.000Z')].join('\n') + '\n')
    const stamp = new Date(2026, 8, 28, 10, 0, 0).getTime()
    writeCursorDb(home, [
      { timestamp: stamp, model: 'auto-smart', fileName: '/home/me/Desktop/Projects/Team/JuCeipt/a.ts', requestId: 'r1', conversationId: 'c1' },
      { timestamp: stamp, model: 'auto-smart', fileName: '/home/me/Desktop/Projects/Team/JuCeipt/b.ts', requestId: 'r2', conversationId: 'c1' },
    ])

    const fromNode = readLocalUsage(home, new Date(2026, 8, 28, 12))
    const out = execFileSync('python3', ['-', 'usage'], { input: remoteScript, env: { ...process.env, HOME: home, DIOS_HOME: home }, encoding: 'utf8' })
    const fromPython = JSON.parse(out) as { ok: boolean; entries: UsageEntry[] }
    expect(fromPython.ok).toBe(true)
    const strip = (entries: UsageEntry[]) => entries.map((entry) => ({ ...entry })).sort((left, right) => `${left.tool}${left.model}`.localeCompare(`${right.tool}${right.model}`))
    expect(strip(fromPython.entries)).toEqual(strip(fromNode))
    expect(fromPython.entries.find((entry) => entry.tool === 'cursor')).toMatchObject({ project: 'JuCeipt', count: 2, chats: 1 })
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe('prices', () => {
  it('knows the families and falls back for strangers', () => {
    expect(priceFor('claude-opus-5').input).toBe(15)
    expect(priceFor('claude-sonnet-5').output).toBe(15)
    expect(priceFor('gpt-5.6-luna').input).toBe(1.25)
    expect(priceFor('gpt-5-mini').output).toBe(2)
    expect(priceFor('something-else').output).toBe(10)
    expect(costOf('claude-sonnet-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(3)
  })
})

describe('the 사용량 screen', () => {
  const now = new Date(2026, 8, 28, 12, 0, 0)
  const entry = (over: Partial<UsageEntry>): UsageEntry => ({ tool: 'claude_code', day: '2026-09-28', project: 'Agent-Relay', model: 'claude-sonnet-5', input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, ...over })

  it('says there is nothing when no logs were found', () => {
    const screen = buildUsageScreen({ now, sources: [{ place: '이 컴퓨터', ok: true, problem: '', entries: [] }], keys: [], caps: {} })
    expect(screen.headline).toBe('아직 읽을 사용 기록이 없어요.')
    expect(screen.cards).toHaveLength(0)
    expect(screen.alerts).toBe(0)
  })

  it('adds up today, week, month, and last month per tool across computers', () => {
    const screen = buildUsageScreen({
      now,
      sources: [
        { place: '이 컴퓨터', ok: true, problem: '', entries: [entry({}), entry({ day: '2026-09-20' }), entry({ day: '2026-08-15' })] },
        { place: 'asus', ok: true, problem: '', entries: [entry({ day: '2026-09-27', tool: 'codex', model: 'gpt-5.6-luna' }), entry({ project: 'JuCeipt' })] },
      ],
      keys: [],
      caps: {},
    })
    const claude = screen.cards.find((card) => card.id === 'tool:claude_code')!
    expect(claude.today).toBeCloseTo(6)
    expect(claude.week).toBeCloseTo(6)
    expect(claude.month).toBeCloseTo(9)
    expect(claude.lastMonth).toBeCloseTo(3)
    expect(claude.bars).toHaveLength(14)
    expect(claude.byPlace.map((row) => row.place)).toEqual(['이 컴퓨터', 'asus'])
    expect(claude.kind).toBe('subscription')
    const codex = screen.cards.find((card) => card.id === 'tool:codex')!
    expect(codex.month).toBeCloseTo(1.25)
    expect(screen.headline).toContain('약 10.3달러어치')
    expect(screen.headline).toContain('Claude Code')
    expect(screen.projects[0]).toEqual({ name: 'Agent Relay', month: expect.closeTo(7.25, 5), tools: ['Claude Code', 'Codex'] })
    expect(screen.projects.find((project) => project.name === 'JuCeipt')?.tools).toEqual(['Claude Code'])
    // 28 days in, 10.25 so far → about 11 by the 30th.
    expect(claude.projected).toBeCloseTo((9 / 28) * 30)
    expect(screen.quiet).toContain('월말엔 약')
  })

  it('folds small unknown folders under 그 밖의 폴더 but keeps products and big folders', () => {
    const screen = buildUsageScreen({
      now,
      sources: [{
        place: '이 컴퓨터',
        ok: true,
        problem: '',
        entries: [
          entry({ project: 'JuControler-Private' }),
          entry({ project: 'actl-v0.1.1-managed', input: 100_000 }),
          entry({ project: 'Big-Folder', input: 2_000_000 }),
          entry({ project: 'tiny-thing', input: 10_000 }),
          entry({ project: 'skkse12', input: 10_000 }),
        ],
      }],
      keys: [],
      caps: {},
    })
    expect(screen.projects.map((project) => project.name)).toEqual(['Big-Folder', 'JuControler', 'actl', '홈 폴더'])
    expect(screen.otherProjects.map((project) => project.name)).toEqual(['tiny-thing'])
  })

  it('gives Cursor a count card that sorts after money and never gets a cap', () => {
    const screen = buildUsageScreen({
      now,
      sources: [{
        place: '이 컴퓨터',
        ok: true,
        problem: '',
        entries: [
          entry({}),
          { tool: 'cursor', day: '2026-09-28', project: 'Dios', model: 'auto-smart', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 40, chats: 3 },
          { tool: 'cursor', day: '2026-09-20', project: 'Dios', model: 'auto-smart', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 10, chats: 2 },
        ],
      }],
      keys: [],
      caps: { 'tool:cursor': 5 },
    })
    expect(screen.cards.map((card) => card.id)).toEqual(['tool:claude_code', 'tool:cursor'])
    const cursor = screen.cards[1]
    expect(cursor.kind).toBe('count')
    expect(cursor.today).toBe(40)
    expect(cursor.month).toBe(50)
    expect(cursor.monthChats).toBe(5)
    expect(cursor.cap).toBe(0)
    expect(cursor.tone).toBe('ok')
    expect(cursor.lines[0]).toContain('대화 5번, 요청 50번')
    expect(screen.projects[0].tools).toEqual(['Claude Code'])
  })

  it('speaks about Cursor alone when there is no money to show', () => {
    const screen = buildUsageScreen({
      now,
      sources: [{ place: '이 컴퓨터', ok: true, problem: '', entries: [{ tool: 'cursor', day: '2026-09-28', project: 'Dios', model: 'auto-smart', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 4, chats: 2 }] }],
      keys: [],
      caps: {},
    })
    expect(screen.headline).toBe('이번 달 Cursor로 2번 대화했어요.')
  })

  it('compares this week with last week in one line', () => {
    expect(trendLine(0, 0)).toBe('')
    expect(trendLine(5, 0)).toBe('')
    expect(trendLine(13, 10)).toBe('지난주보다 30% 많이 쓰고 있어요.')
    expect(trendLine(10.5, 10)).toBe('지난주와 비슷하게 쓰고 있어요.')
    expect(trendLine(5, 10)).toBe('지난주보다 50% 적게 쓰고 있어요.')
    expect(trendLine(30, 10)).toBe('지난주보다 3배 많이 쓰고 있어요.')
    const screen = buildUsageScreen({
      now,
      sources: [{ place: '이 컴퓨터', ok: true, problem: '', entries: [entry({ day: '2026-09-27' }), entry({ day: '2026-09-18' }), entry({ day: '2026-09-19' })] }],
      keys: [],
      caps: {},
    })
    expect(screen.trend).toBe('지난주보다 50% 적게 쓰고 있어요.')
  })

  it('turns amber near the amount and red over it, and counts those for the badge', () => {
    const sources = [{ place: '이 컴퓨터', ok: true, problem: '', entries: [entry({}), entry({ tool: 'codex', model: 'gpt-5.6-luna' })] }]
    const near = buildUsageScreen({ now, sources, keys: [], caps: { 'tool:claude_code': 3.5, 'tool:codex': 100 } })
    expect(near.cards.find((card) => card.id === 'tool:claude_code')!.tone).toBe('watch')
    expect(near.cards.find((card) => card.id === 'tool:codex')!.tone).toBe('ok')
    expect(near.alerts).toBe(1)
    const over = buildUsageScreen({ now, sources, keys: [], caps: { 'tool:claude_code': 2 } })
    expect(over.cards[0].tone).toBe('over')
    expect(over.quiet).toBe('Claude Code 사용이 정해 둔 금액을 넘었어요.')
  })

  it('shows OpenRouter money, links OpenAI and Anthropic to their sites', () => {
    const screen = buildUsageScreen({
      now,
      sources: [],
      keys: [
        { serviceId: 'or', name: 'JuPlan · OpenRouter · 메인', type: 'openrouter', snapshot: { serviceId: 'or', serviceName: '', type: 'openrouter', used: 12, limit: 50, remaining: 38, percent: 24, resetAt: 0, currency: 'USD', status: 'success', fetchedAt: now.getTime(), daily: 1, weekly: 4, monthly: 12 } },
        { serviceId: 'oa', name: 'Dios · OpenAI', type: 'openai', snapshot: null },
        { serviceId: 'an', name: 'Dios · Anthropic (Claude) · 키', type: 'claude_code', snapshot: null },
      ],
      caps: {},
    })
    const router = screen.cards.find((card) => card.id === 'key:or')!
    expect(router.kind).toBe('api')
    expect(router.month).toBe(12)
    expect(router.cap).toBe(50)
    expect(router.title).toBe('OpenRouter · JuPlan 메인')
    expect(screen.cards.find((card) => card.id === 'key:oa')!.link).toContain('platform.openai.com')
    expect(screen.cards.find((card) => card.id === 'key:an')!.kind).toBe('link')
    expect(screen.headline).toContain('약 12달러어치')
  })

  it('words money, tokens, and folder names the Founder way', () => {
    expect(dollars(0)).toBe('0달러')
    expect(dollars(3.456)).toBe('3.46달러')
    expect(dollars(34.56)).toBe('34.6달러')
    expect(dollars(1234.5)).toBe('1,235달러')
    expect(tokens(820)).toBe('820 토큰')
    expect(tokens(450_000)).toBe('45만 토큰')
    expect(tokens(320_000_000)).toBe('3.2억 토큰')
    expect(projectName('agent-relay')).toBe('Agent Relay')
    expect(projectName('JuControler-Private')).toBe('JuControler')
    expect(projectName('actl-v0.1.1-managed')).toBe('actl')
    expect(projectName('Some-Folder')).toBe('Some-Folder')
    expect(projectName('skkse12')).toBe('홈 폴더')
    expect(projectName('Team')).toBe('여러 프로젝트 폴더')
    expect(projectName('')).toBe('폴더 모름')
  })

  it('says what happened today in one project', () => {
    const entries: UsageEntry[] = [
      { tool: 'claude_code', day: '2026-09-29', project: 'Dios', model: 'claude-sonnet-4', input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { tool: 'codex', day: '2026-09-29', project: 'Dios', model: 'gpt-5', input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { tool: 'cursor', day: '2026-09-29', project: 'Dios', model: 'composer', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, chats: 4 },
      { tool: 'claude_code', day: '2026-09-29', project: 'other', model: 'claude-sonnet-4', input: 5_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { tool: 'claude_code', day: '2026-09-28', project: 'Dios', model: 'claude-sonnet-4', input: 5_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    ]
    const line = todaySentence(entries, '2026-09-29', 'DIOS')
    expect(line).toContain('오늘 DIOS에서')
    expect(line).toContain('Claude Code를 약 3달러어치')
    expect(line).toContain('Codex를 약')
    expect(line).toContain('Cursor로 4번 대화했어요')
    expect(line).not.toContain('15달러')
    expect(todaySentence([], '2026-09-29', 'DIOS')).toContain('아직 없어요')
    expect(todaySentence(entries, '2026-09-29')).toContain('이 컴퓨터')
  })

  it('draws one week per agent for one project', () => {
    const now = new Date(2026, 8, 29, 12)
    const entries: UsageEntry[] = [
      { tool: 'claude_code', day: '2026-09-29', project: 'Dios', model: 'claude-sonnet-4', input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { tool: 'claude_code', day: '2026-09-27', project: 'Dios', model: 'claude-sonnet-4', input: 3_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { tool: 'codex', day: '2026-09-28', project: 'Dios', model: 'gpt-5', input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { tool: 'cursor', day: '2026-09-29', project: 'Dios', model: 'composer', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, chats: 4 },
      { tool: 'claude_code', day: '2026-09-20', project: 'Dios', model: 'claude-sonnet-4', input: 9_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { tool: 'claude_code', day: '2026-09-29', project: 'other', model: 'claude-sonnet-4', input: 9_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    ]
    const graph = weekGraph(entries, now, 'DIOS')
    expect(graph.days).toHaveLength(7)
    expect(graph.days[6]).toBe('2026-09-29')
    expect(graph.labels[6]).toBe('화')
    expect(graph.agents.map((agent) => agent.id)).toEqual(['claude_code', 'codex', 'cursor'])
    const claude = graph.agents[0]
    expect(claude.days[6]).toBeCloseTo(3, 1)
    expect(claude.days[4]).toBeCloseTo(9, 1)
    expect(claude.share).toBeGreaterThan(0.8)
    expect(graph.agents[2].week).toBe(4)
    expect(graph.agents[2].share).toBe(0)
    expect(graph.sentence).toContain('이번 주 DIOS에서 약')
    expect(graph.sentence).toContain('Claude Code')
    expect(weekGraph([], now, 'DIOS').sentence).toContain('아직 없어요')
    expect(weekGraph(entries.filter((entry) => entry.tool === 'cursor'), now).sentence).toContain('Cursor로 4번')
  })
})
