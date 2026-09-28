import { knownProjectLabel } from '../skill-board/project-skills'
import type { LogTool, UsageEntry } from './local-logs'
import { costOf } from './pricing'
import type { AgentUsageSnapshot } from './types'
import { dayOf, daysInMonth, lastDays, shiftMonth } from './usage-time'

/**
 * subscription: paid monthly, numbers are what the API would have cost.
 * api: real spending. count: only how often it was used (Cursor). link: only the site knows.
 */
export type UsageKind = 'subscription' | 'api' | 'count' | 'link'

/** teal ok · amber needs a look · red over the amount the Founder set. */
export type UsageTone = 'ok' | 'watch' | 'over'

export interface UsageBar {
  day: string
  value: number
}

export interface UsageCard {
  id: string
  title: string
  kind: UsageKind
  /** USD for money cards; requests for count cards. */
  today: number
  week: number
  month: number
  lastMonth: number
  /** Where this month ends up at the current pace. 0 when too early to say. */
  projected: number
  monthTokens: number
  /** Distinct chats this month (count cards). */
  monthChats: number
  /** Last 14 days, oldest first. */
  bars: UsageBar[]
  /** 0 when the Founder has not set one. */
  cap: number
  tone: UsageTone
  /** Plain Korean, one or two short lines. */
  lines: string[]
  /** "이 컴퓨터 12달러 · asus 40달러" pieces, when more than one computer wrote logs. */
  byPlace: Array<{ place: string; month: number }>
  /** Most used models this month, most first. */
  models: string[]
  lastUsed: string
  /** Site to open for link and api cards. */
  link: string
}

export interface UsageProject {
  name: string
  month: number
  tools: string[]
}

export interface UsagePlace {
  name: string
  ok: boolean
  problem: string
}

export interface UsageScreen {
  headline: string
  quiet: string
  /** "지난주보다 30% 많이 썼어요" or ''. */
  trend: string
  cards: UsageCard[]
  /** Known products and big folders, most first. */
  projects: UsageProject[]
  /** Small or unknown folders, folded under 그 밖의 폴더. */
  otherProjects: UsageProject[]
  places: UsagePlace[]
  /** Cards that are over or close to their amount. Shown on the nav badge. */
  alerts: number
  /** Cards over their amount; the badge turns red when this is above zero. */
  over: number
  builtAt: number
}

export interface UsageSource {
  place: string
  ok: boolean
  problem: string
  entries: UsageEntry[]
}

export interface KeyUsage {
  serviceId: string
  name: string
  type: string
  snapshot: AgentUsageSnapshot | null
}

export interface UsageInput {
  now?: Date
  sources: UsageSource[]
  keys: KeyUsage[]
  caps: Record<string, number>
}

const TOOL_TITLES: Record<LogTool, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
}

const LINKS: Record<string, string> = {
  openai: 'https://platform.openai.com/usage',
  claude_code: 'https://console.anthropic.com/settings/usage',
}

const LINK_TITLES: Record<string, string> = {
  openai: 'OpenAI',
  claude_code: 'Anthropic',
  openrouter: 'OpenRouter',
}

const HOME_FOLDERS = new Set(['skkse12', 'user', 'home', 'users', 'desktop', 'documents'])
/** Folders that hold several projects; an agent run there is not one project's work. */
const SHARED_FOLDERS = new Set(['projects', 'core', 'team', 'personal', 'work', 'src', 'repos', 'code', 'dev', 'tmp', 'temp', 'workspace', 'ws'])

/** Folder name pieces that mean one of the Founder's products, longest first so juactl wins over actl. */
const PRODUCT_HINTS: Array<[string, string]> = [
  ['agent-relay', 'Agent Relay'],
  ['agentrelay', 'Agent Relay'],
  ['jucontroler', 'JuControler'],
  ['juceipt', 'JuCeipt'],
  ['juplan', 'JuPlan'],
  ['juradar', 'JuRadar'],
  ['jutell', 'JuTell'],
  ['juactl', 'actl'],
  ['actl', 'actl'],
  ['juai', 'JuAI'],
  ['dios', 'DIOS'],
  ['hermes', 'Hermes'],
]

/** Folders under this share of the month are folded into 그 밖의 폴더 unless they are a known product. */
const OTHER_SHARE = 0.08
/** Days into the month before the pace is worth showing. */
const MIN_DAYS_FOR_PACE = 3

/** Turn raw entries and key snapshots into the whole 사용량 screen. Pure, so it is easy to test. */
export function buildUsageScreen(input: UsageInput): UsageScreen {
  const now = input.now ?? new Date()
  const today = dayOf(undefined, now)
  const monthStart = today.slice(0, 7)
  const lastMonthStart = shiftMonth(monthStart, -1)
  const weekDays = new Set(lastDays(now, 7))
  const previousWeekDays = new Set(lastDays(now, 7, 7))
  const barDays = lastDays(now, 14)
  const dayOfMonth = now.getDate()
  const monthLength = daysInMonth(now)

  const cards: UsageCard[] = []
  const tools = new Map<LogTool, Array<{ place: string; entry: UsageEntry }>>()
  for (const source of input.sources) {
    for (const entry of source.entries) {
      const list = tools.get(entry.tool) ?? []
      list.push({ place: source.place, entry })
      tools.set(entry.tool, list)
    }
  }

  let weekTotal = 0
  let previousWeekTotal = 0

  for (const tool of ['claude_code', 'codex', 'cursor'] as LogTool[]) {
    const rows = tools.get(tool)
    if (!rows?.length) continue
    const id = `tool:${tool}`
    const counting = tool === 'cursor'
    let todaySum = 0
    let week = 0
    let month = 0
    let lastMonth = 0
    let monthTokens = 0
    let monthChats = 0
    let lastUsed = ''
    const barMap = new Map<string, number>(barDays.map((day) => [day, 0]))
    const byPlace = new Map<string, number>()
    const byModel = new Map<string, number>()
    for (const { place, entry } of rows) {
      const value = counting ? entry.count ?? 0 : costOf(entry.model, entry)
      if (entry.day === today) todaySum += value
      if (weekDays.has(entry.day)) week += value
      if (entry.day.startsWith(monthStart)) {
        month += value
        monthTokens += entry.input + entry.output + entry.cacheRead + entry.cacheWrite
        monthChats += entry.chats ?? 0
        byPlace.set(place, (byPlace.get(place) ?? 0) + value)
        byModel.set(entry.model, (byModel.get(entry.model) ?? 0) + value)
      }
      if (entry.day.startsWith(lastMonthStart)) lastMonth += value
      if (barMap.has(entry.day)) barMap.set(entry.day, (barMap.get(entry.day) ?? 0) + value)
      if (entry.day > lastUsed && entry.day <= today) lastUsed = entry.day
      if (!counting) {
        if (weekDays.has(entry.day)) weekTotal += value
        if (previousWeekDays.has(entry.day)) previousWeekTotal += value
      }
    }
    const cap = counting ? 0 : input.caps[id] ?? 0
    const tone = toneFor(month, cap)
    const projected = dayOfMonth >= MIN_DAYS_FOR_PACE && month > 0 ? (month / dayOfMonth) * monthLength : 0
    const lines = counting
      ? [
          `Cursor는 돈이 아니라 횟수만 남겨요. 이번 달 대화 ${count(monthChats)}번, 요청 ${count(month)}번이에요.`,
          lastMonth > 0 ? `지난달은 요청 ${count(lastMonth)}번이었어요.` : '',
        ].filter(Boolean)
      : [
          `구독으로 쓰는 중이라 실제 청구는 아니에요. API로 썼다면 이번 달 약 ${dollars(month)}예요.`,
          projected > 0 && dayOfMonth < monthLength ? `이대로 가면 월말엔 약 ${dollars(projected)}예요.${lastMonth > 0 ? ` 지난달은 약 ${dollars(lastMonth)}였어요.` : ''}` : lastMonth > 0 ? `지난달은 약 ${dollars(lastMonth)}였어요.` : '',
        ].filter(Boolean)
    cards.push({
      id,
      title: TOOL_TITLES[tool],
      kind: counting ? 'count' : 'subscription',
      today: todaySum,
      week,
      month,
      lastMonth,
      projected,
      monthTokens,
      monthChats,
      bars: barDays.map((day) => ({ day, value: barMap.get(day) ?? 0 })),
      cap,
      tone,
      lines,
      byPlace: [...byPlace.entries()].map(([place, value]) => ({ place, month: value })).sort((left, right) => right.month - left.month),
      models: [...byModel.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([model]) => model),
      lastUsed,
      link: '',
    })
  }

  for (const key of input.keys) {
    const id = `key:${key.serviceId}`
    const cap = input.caps[id] ?? key.snapshot?.limit ?? 0
    if (key.type === 'openrouter') {
      const snap = key.snapshot
      const month = snap && snap.status !== 'error' ? (snap.monthly && snap.monthly > 0 ? snap.monthly : snap.used) : 0
      const failed = !snap || snap.status === 'error'
      const projected = dayOfMonth >= MIN_DAYS_FOR_PACE && month > 0 ? (month / dayOfMonth) * monthLength : 0
      cards.push({
        id,
        title: `OpenRouter · ${keyLabel(key.name)}`,
        kind: 'api',
        today: snap?.daily ?? 0,
        week: snap?.weekly ?? 0,
        month,
        lastMonth: 0,
        projected,
        monthTokens: 0,
        monthChats: 0,
        bars: [],
        cap,
        tone: failed ? 'watch' : toneFor(month, cap),
        lines: failed
          ? ['사용량을 못 받았어요. 키가 살아 있는지, 인터넷이 되는지 봐 주세요.']
          : [`이 키로 실제로 쓴 돈이에요. ${cap ? `정해 둔 ${dollars(cap)} 중 ${percent(month, cap)}를 썼어요.` : '한도는 아직 안 정했어요.'}`],
        byPlace: [],
        models: [],
        lastUsed: snap?.fetchedAt ? dayOf(new Date(snap.fetchedAt).toISOString(), now) : '',
        link: 'https://openrouter.ai/settings/credits',
      })
      continue
    }
    const link = LINKS[key.type]
    if (!link) continue
    cards.push({
      id,
      title: `${LINK_TITLES[key.type] ?? key.type} · ${keyLabel(key.name)}`,
      kind: 'link',
      today: 0,
      week: 0,
      month: 0,
      lastMonth: 0,
      projected: 0,
      monthTokens: 0,
      monthChats: 0,
      bars: [],
      cap: 0,
      tone: 'ok',
      lines: ['이 회사는 프로그램에서 사용량을 안 알려줘요. 사이트에서 로그인하면 바로 보여요.'],
      byPlace: [],
      models: [],
      lastUsed: '',
      link,
    })
  }

  // Money first and biggest first; Cursor's counts after; site links last.
  const order: Record<UsageKind, number> = { subscription: 0, api: 0, count: 1, link: 2 }
  cards.sort((left, right) => order[left.kind] - order[right.kind] || right.month - left.month)

  const { projects, otherProjects } = projectRollup(input.sources, monthStart)
  const places = input.sources.map((source) => ({ name: source.place, ok: source.ok, problem: source.problem }))
  const alerts = cards.filter((card) => card.tone !== 'ok').length
  const over = cards.filter((card) => card.tone === 'over').length
  const spend = cards.filter((card) => card.kind === 'subscription' || card.kind === 'api')
  const total = spend.reduce((sum, card) => sum + card.month, 0)
  const top = [...spend].sort((left, right) => right.month - left.month)[0]
  const projectedTotal = spend.reduce((sum, card) => sum + card.projected, 0)
  const trend = trendLine(weekTotal, previousWeekTotal)

  let headline: string
  let quiet: string
  if (!spend.length && !cards.some((card) => card.kind === 'count')) {
    headline = '아직 읽을 사용 기록이 없어요.'
    quiet = 'Claude Code, Codex, Cursor를 쓰면 이 컴퓨터의 기록을 읽어서 여기에 보여 드려요. 화면을 열 때만 읽고, 뒤에서 돌아가는 건 없어요.'
  } else if (!spend.length) {
    const cursor = cards.find((card) => card.kind === 'count')!
    headline = `이번 달 Cursor로 ${count(cursor.monthChats)}번 대화했어요.`
    quiet = 'Cursor는 돈이 아니라 횟수만 남겨요. Claude Code나 Codex를 쓰면 금액도 같이 나와요.'
  } else {
    const overCards = cards.filter((card) => card.tone === 'over')
    headline = `이번 달 AI 사용은 약 ${dollars(total)}어치예요.${top && top.month > 0 ? ` 가장 많이 쓴 건 ${top.title}예요.` : ''}`
    if (overCards.length) {
      quiet = `${overCards.map((card) => card.title).join(', ')} 사용이 정해 둔 금액을 넘었어요.`
    } else if (projectedTotal > 0 && dayOfMonth < monthLength) {
      quiet = `이대로 가면 월말엔 약 ${dollars(projectedTotal)}어치예요.${spend.every((card) => card.kind === 'subscription') ? ' 모두 구독이라 실제로 청구되는 돈은 아니에요.' : ''}`
    } else {
      quiet = spend.every((card) => card.kind === 'subscription')
        ? '모두 구독으로 쓰고 있어서 실제로 청구되는 돈은 아니에요. 화면을 열 때만 새로 읽어요.'
        : '화면을 열 때만 새로 읽어요. 뒤에서 돌아가는 건 없어요.'
    }
  }

  return { headline, quiet, trend, cards, projects, otherProjects, places, alerts, over, builtAt: now.getTime() }
}

/** How many cards need a look, from cached entries alone. Used for the nav badge at start. */
export function countUsageAlerts(sources: UsageSource[], caps: Record<string, number>, now: Date = new Date()): { alerts: number; over: number } {
  const screen = buildUsageScreen({ now, sources, keys: [], caps })
  return { alerts: screen.alerts, over: screen.over }
}

/** True when a log folder is the project the Founder has open. An empty label means every folder. */
export function sameProject(folder: string, label: string): boolean {
  const want = label.trim().toLowerCase()
  if (!want) return true
  return projectName(folder).toLowerCase() === want || folder.toLowerCase() === want
}

/**
 * One sentence for what happened today in one project, or on the whole computer when the label is empty.
 * Money tools say the API-equivalent amount. Cursor says how many chats.
 */
export function todaySentence(entries: UsageEntry[], day: string, projectLabel = ''): string {
  const rows = entries.filter((entry) => entry.day === day && sameProject(entry.project, projectLabel))
  const where = projectLabel.trim() || '이 컴퓨터'
  if (!rows.length) return projectLabel.trim() ? `오늘 ${where}에서 한 기록은 아직 없어요.` : '오늘은 아직 기록이 없어요.'
  const money: string[] = []
  for (const tool of ['claude_code', 'codex'] as const) {
    const cost = rows.filter((entry) => entry.tool === tool).reduce((sum, entry) => sum + costOf(entry.model, entry), 0)
    if (cost >= 0.005) money.push(`${TOOL_TITLES[tool]}를 약 ${dollars(cost)}어치`)
  }
  const chats = rows.filter((entry) => entry.tool === 'cursor').reduce((sum, entry) => sum + (entry.chats || entry.count || 0), 0)
  const cursor = chats > 0 ? `Cursor로 ${count(chats)}번 대화했어요.` : ''
  if (money.length && cursor) return `오늘 ${where}에서 ${money.join(', ')} 썼고, ${cursor}`
  if (money.length) return `오늘 ${where}에서 ${money.join(', ')} 썼어요.`
  if (cursor) return `오늘 ${where}에서 ${cursor}`
  return `오늘 ${where}에서 한 기록은 아직 없어요.`
}

/** "지난주보다 30% 많이 썼어요", "지난주와 비슷해요", or '' when one of the weeks is empty. */
export function trendLine(thisWeek: number, lastWeek: number): string {
  if (lastWeek < 0.5 || thisWeek < 0.005) return ''
  const change = (thisWeek - lastWeek) / lastWeek
  if (Math.abs(change) < 0.1) return '지난주와 비슷하게 쓰고 있어요.'
  const pct = Math.round(Math.abs(change) * 100)
  if (change > 0) return pct >= 100 ? `지난주보다 ${Math.round(thisWeek / lastWeek * 10) / 10}배 많이 쓰고 있어요.` : `지난주보다 ${pct}% 많이 쓰고 있어요.`
  return `지난주보다 ${pct}% 적게 쓰고 있어요.`
}

function projectRollup(sources: UsageSource[], monthStart: string): { projects: UsageProject[]; otherProjects: UsageProject[] } {
  const map = new Map<string, { month: number; tools: Set<string>; known: boolean }>()
  let total = 0
  for (const source of sources) {
    for (const entry of source.entries) {
      if (!entry.day.startsWith(monthStart) || entry.tool === 'cursor') continue
      const name = projectName(entry.project)
      const row = map.get(name) ?? { month: 0, tools: new Set<string>(), known: isKnownProject(entry.project) }
      const cost = costOf(entry.model, entry)
      row.month += cost
      total += cost
      row.tools.add(TOOL_TITLES[entry.tool])
      map.set(name, row)
    }
  }
  // Cursor adds which tool touched a project, without money.
  for (const source of sources) {
    for (const entry of source.entries) {
      if (!entry.day.startsWith(monthStart) || entry.tool !== 'cursor') continue
      const row = map.get(projectName(entry.project))
      if (row) row.tools.add('Cursor')
    }
  }
  const rows = [...map.entries()]
    .map(([name, row]) => ({ name, month: row.month, tools: [...row.tools].sort(), known: row.known }))
    .filter((row) => row.month >= 0.01)
    .sort((left, right) => right.month - left.month)
  const projects: UsageProject[] = []
  const otherProjects: UsageProject[] = []
  for (const row of rows) {
    const { known, ...project } = row
    if (known || (total > 0 && row.month / total >= OTHER_SHARE) || project.name === '홈 폴더' || project.name === '여러 프로젝트 폴더') projects.push(project)
    else otherProjects.push(project)
  }
  return { projects: projects.slice(0, 12), otherProjects }
}

/** True when the folder name points at one of the Founder's products. */
export function isKnownProject(folder: string): boolean {
  if (!folder) return false
  if (knownProjectLabel(folder)) return true
  const lowered = folder.toLowerCase()
  return PRODUCT_HINTS.some(([hint]) => lowered.includes(hint))
}

/** The Founder's name for a folder the agent worked in. */
export function projectName(folder: string): string {
  if (!folder) return '폴더 모름'
  if (HOME_FOLDERS.has(folder.toLowerCase())) return '홈 폴더'
  if (SHARED_FOLDERS.has(folder.toLowerCase())) return '여러 프로젝트 폴더'
  const known = knownProjectLabel(folder)
  if (known) return known
  const lowered = folder.toLowerCase()
  for (const [hint, label] of PRODUCT_HINTS) {
    if (lowered.includes(hint)) return label
  }
  return folder
}

function keyLabel(serviceName: string): string {
  // Service names look like "프로젝트 · 플랫폼 · 라벨"; the platform is already in the title.
  const parts = serviceName.split(' · ').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 3) return `${parts[0]} ${parts[2]}`
  return parts[0] ?? serviceName
}

function toneFor(month: number, cap: number): UsageTone {
  if (!cap) return 'ok'
  if (month >= cap) return 'over'
  if (month >= cap * 0.8) return 'watch'
  return 'ok'
}

/** "약 12.3달러" style. Under one cent reads as 0달러. */
export function dollars(value: number): string {
  if (!Number.isFinite(value) || value < 0.005) return '0달러'
  if (value >= 100) return `${Math.round(value).toLocaleString('ko-KR')}달러`
  if (value >= 10) return `${(Math.round(value * 10) / 10).toString()}달러`
  return `${(Math.round(value * 100) / 100).toString()}달러`
}

/** "3.2억 토큰", "45만 토큰", "820 토큰". */
export function tokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 토큰'
  if (value >= 1e8) return `${(Math.round(value / 1e7) / 10).toString()}억 토큰`
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString('ko-KR')}만 토큰`
  return `${Math.round(value).toLocaleString('ko-KR')} 토큰`
}

/** Whole numbers with Korean grouping: 1,234. */
export function count(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Math.round(value).toLocaleString('ko-KR')
}

function percent(part: number, whole: number): string {
  if (!whole) return '0%'
  return `${Math.round((part / whole) * 100)}%`
}
