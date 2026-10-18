import type { HeadlessProcess, ScheduledJob } from './types'

/** Split CSV text with quoted fields (schtasks and PowerShell output). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    if (row.some((value) => value !== '')) rows.push(row)
  }
  return rows
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function hourText(hour: number, minute: number): string {
  const base = `${hour}시`
  return minute ? `${base} ${minute}분` : base
}

/** Plain Korean for the five cron fields, falling back to the raw text. */
export function cronText(fields: string): string {
  const raw = fields.trim()
  const named: Record<string, string> = {
    '@reboot': '컴퓨터를 켤 때마다',
    '@hourly': '매시 정각',
    '@daily': '매일 0시',
    '@midnight': '매일 0시',
    '@weekly': '매주 일요일 0시',
    '@monthly': '매달 1일 0시',
    '@yearly': '매년 1월 1일',
    '@annually': '매년 1월 1일',
  }
  if (named[raw]) return named[raw]
  const parts = raw.split(/\s+/)
  if (parts.length !== 5) return raw
  const [minute, hour, day, month, weekday] = parts
  const everyMinute = /^\*\/(\d+)$/.exec(minute)
  if (everyMinute && hour === '*' && day === '*' && month === '*' && weekday === '*') return `${everyMinute[1]}분마다`
  const everyHour = /^\*\/(\d+)$/.exec(hour)
  if (/^\d+$/.test(minute) && everyHour && day === '*' && month === '*' && weekday === '*') return `${everyHour[1]}시간마다`
  if (/^\d+$/.test(minute) && hour === '*' && day === '*' && month === '*' && weekday === '*') return Number(minute) ? `매시 ${Number(minute)}분` : '매시 정각'
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && month === '*') {
    const when = hourText(Number(hour), Number(minute))
    if (day === '*' && weekday === '*') return `매일 ${when}`
    if (day === '*' && /^[0-7]$/.test(weekday)) return `매주 ${WEEKDAYS[Number(weekday) % 7]}요일 ${when}`
    if (day === '*' && weekday === '1-5') return `평일 ${when}`
    if (/^\d+$/.test(day) && weekday === '*') return `매달 ${Number(day)}일 ${when}`
  }
  return raw
}

/** Jobs in a user's crontab text. Comments, blanks, and VAR=value lines are skipped. */
export function parseCrontab(text: string): ScheduledJob[] {
  const jobs: ScheduledJob[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue
    let schedule = ''
    let command = ''
    if (line.startsWith('@')) {
      const space = line.indexOf(' ')
      if (space < 0) continue
      schedule = line.slice(0, space)
      command = line.slice(space + 1).trim()
    } else {
      const parts = line.split(/\s+/)
      if (parts.length < 6) continue
      schedule = parts.slice(0, 5).join(' ')
      command = parts.slice(5).join(' ')
    }
    jobs.push({ kind: 'cron', name: jobName(command), schedule: cronText(schedule), command, lastRunAt: 0, nextRunAt: 0, enabled: true })
  }
  return jobs
}

/** A short name for a command line: the script or program, without the folder. */
export function jobName(command: string): string {
  const cleaned = command.replace(/\s*(>|2>|&>|\|).*$/, '').trim()
  const tokens = cleaned.split(/\s+/).filter(Boolean)
  if (!tokens.length) return command.slice(0, 40)
  const runners = new Set(['python', 'python3', 'py', 'node', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'npx', 'npm', 'pnpm', 'yarn', 'flock', 'nice', 'timeout', 'env'])
  for (const token of tokens) {
    const base = token.split(/[\\/]/).pop() || token
    if (token.startsWith('-')) continue
    if (runners.has(base.toLowerCase()) || /^[A-Z_]+=/.test(token)) continue
    return base
  }
  return tokens[tokens.length - 1].split(/[\\/]/).pop() || cleaned.slice(0, 40)
}

/** Timers the operating system ships with; they are not the Founder's own jobs. */
const SYSTEM_TIMER_PREFIXES = ['ubuntu-', 'snap.', 'launchpadlib', 'systemd-', 'apt-', 'fstrim', 'man-db', 'logrotate', 'e2scrub', 'motd-news', 'dpkg-db-backup', 'fwupd', 'update-notifier', 'plocate', 'anacron', 'sysstat', 'gnome-', 'tracker-', 'grub-', 'flatpak-']

/** "하루에 한 번", "1시간마다", "매주", from the gap between two runs. */
export function intervalText(ms: number): string {
  if (ms <= 0) return '예약됨'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)}분마다`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1시간마다' : `${hours}시간마다`
  const days = Math.round(hours / 24)
  if (days === 1) return '하루에 한 번'
  if (days === 7) return '매주'
  if (days >= 28 && days <= 31) return '매달'
  return `${days}일마다`
}

/** `systemctl --user list-timers --all --output=json`. Times arrive as microseconds since epoch. */
export function parseSystemdTimers(json: string): ScheduledJob[] {
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(rows)) return []
  const toMs = (value: unknown) => (typeof value === 'number' && value > 0 ? Math.floor(value / 1000) : 0)
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const entry = row as Record<string, unknown>
    const unit = String(entry.unit ?? '')
    if (!unit) return []
    const name = unit.replace(/\.timer$/, '')
    if (SYSTEM_TIMER_PREFIXES.some((prefix) => name.startsWith(prefix))) return []
    const activates = String(entry.activates ?? '')
    const lastRunAt = toMs(entry.last)
    const nextRunAt = toMs(entry.next)
    return [{
      kind: 'systemd' as const,
      name,
      schedule: lastRunAt && nextRunAt ? intervalText(nextRunAt - lastRunAt) : '예약됨',
      command: activates || unit,
      lastRunAt,
      nextRunAt,
      enabled: nextRunAt > 0,
    }]
  })
}

/**
 * `schtasks /query /fo CSV /v`. The column order is the same in every language, so columns are
 * picked by position: 1 name, 2 next run, 3 status, 5 last run, 8 task to run, 18 schedule type,
 * 19 start time, 20 start date, 21 end date, 22 days, 23 months, 24 repeat every.
 */
export function parseSchtasksCsv(text: string, parseDate: (value: string) => number = localDate): ScheduledJob[] {
  const rows = parseCsv(text)
  const jobs: ScheduledJob[] = []
  for (const row of rows) {
    if (row.length < 20) continue
    const name = row[1] || ''
    // Real task names start with a backslash; header rows (repeated per folder) do not.
    if (!name.startsWith('\\')) continue
    if (name.startsWith('\\Microsoft\\') || name.startsWith('\\Windows\\')) continue
    const status = row[3] || ''
    const disabled = /disabled|사용 안 함/i.test(status)
    const scheduleType = row[18] || ''
    const startTime = row[19] || ''
    const days = row[22] || ''
    const repeat = row[24] || ''
    jobs.push({
      kind: 'schtasks',
      name: name.replace(/^\\/, ''),
      schedule: schtasksSchedule(scheduleType, startTime, days, repeat),
      command: row[8] || '',
      lastRunAt: parseDate(row[5] || ''),
      nextRunAt: parseDate(row[2] || ''),
      enabled: !disabled,
    })
  }
  return jobs
}

function schtasksSchedule(type: string, startTime: string, days: string, repeat: string): string {
  const time = startTime.replace(/:\d\d$/, '')
  const lower = type.toLowerCase()
  if (/daily|매일/.test(lower)) return `매일 ${time}`.trim()
  if (/weekly|매주/.test(lower)) return `매주 ${days} ${time}`.replace(/\s+/g, ' ').trim()
  if (/monthly|매월|매달/.test(lower)) return `매달 ${days} ${time}`.replace(/\s+/g, ' ').trim()
  if (/logon|로그온/.test(lower)) return '로그인할 때마다'
  if (/startup|시작|boot/.test(lower)) return '컴퓨터를 켤 때마다'
  if (/idle|유휴/.test(lower)) return '컴퓨터가 쉴 때'
  if (/one time|한 번/.test(lower)) return `한 번 ${time}`.trim()
  if (repeat && !/disabled|사용 안 함|N\/A/i.test(repeat)) return `${repeat}마다`
  return type || '예약됨'
}

function localDate(value: string): number {
  if (!value || /N\/A|해당 없음|없음/i.test(value)) return 0
  const ms = Date.parse(value)
  if (Number.isFinite(ms)) return ms
  const match = /(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?\s*(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (!match) return 0
  let hour = Number(match[5])
  if (match[4] === '오후' && hour < 12) hour += 12
  if (match[4] === '오전' && hour === 12) hour = 0
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, Number(match[6]), Number(match[7] || 0)).getTime()
}

/** Programs that usually run headless from a terminal and get forgotten. */
const DEV_PATTERNS: Array<[RegExp, string]> = [
  [/\bvite\b(?!.*\bbuild\b)/i, 'vite 개발 서버'],
  [/\bnext\b.*\b(dev|start)\b/i, 'Next.js 서버'],
  [/\bnuxt\b/i, 'Nuxt 서버'],
  [/\bwebpack(-dev-server)?\b.*\b(serve|watch)\b|\bwebpack-dev-server\b/i, 'webpack 개발 서버'],
  [/\bnodemon\b|\bts-node-dev\b|\btsx\b.*\bwatch\b/i, '자동 재시작 서버'],
  [/\bvitest\b.*\bwatch\b|\bjest\b.*--watch/i, '테스트 감시'],
  [/\b(npm|pnpm|yarn|bun)\b.*\b(run\s+)?(dev|start|serve|watch)\b/i, '개발 서버 (npm 계열)'],
  [/\belectron\b.*\.$|\belectron\b\s+\S+$/i, 'Electron 앱 (개발 중)'],
  [/http\.server\s*(\d+)?/i, '간단 웹 서버 (python http.server)'],
  [/\buvicorn\b|\bgunicorn\b|\bhypercorn\b/i, 'Python 웹 서버'],
  [/\bflask\b.*\brun\b|\bmanage\.py\b.*\brunserver\b/i, 'Python 웹 서버'],
  [/\bstreamlit\b.*\brun\b/i, 'Streamlit 앱'],
  [/\bjupyter(-lab|-notebook)?\b/i, 'Jupyter'],
  [/\bollama\b.*\bserve\b/i, 'Ollama 서버'],
  [/\bngrok\b|\bcloudflared\b.*\btunnel\b/i, '터널 (바깥에서 들어오는 길)'],
  [/\bcaddy\b.*\brun\b|\bnginx\b/i, '웹 서버'],
  [/\bdocker\b.*\bcompose\b.*\bup\b/i, 'Docker compose'],
  [/\bphp\b.*\s-S\s/i, 'PHP 내장 서버'],
  [/\bcargo\b.*\b(watch|run)\b/i, 'Rust 개발 실행'],
  [/\bgo\b.*\brun\b|\bair\b$/i, 'Go 개발 실행'],
]

/** A plain label for a command line when it looks like a forgotten dev server; '' otherwise. */
export function devSummary(args: string): string {
  const text = args.trim()
  if (!text) return ''
  for (const [pattern, label] of DEV_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    const port = /(?:--port[= ]|-p\s*|:|http\.server\s+)(\d{4,5})\b/.exec(text)
    return port ? `${label} · 포트 ${port[1]}` : label
  }
  return ''
}

export interface RawProcess {
  pid: number
  ppid: number
  name: string
  args: string
  startedAt: number
  rssBytes: number
  cwd?: string
}

/** `ps -eo pid=,ppid=,etimes=,rss=,args=` on Linux/macOS. etimes is seconds since start, rss in KB. */
export function parsePsList(text: string, now: number = Date.now()): RawProcess[] {
  const out: RawProcess[] = []
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(raw)
    if (!match) continue
    const args = match[5].trim()
    const first = args.split(/\s+/)[0] || ''
    out.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      name: first.split('/').pop() || first,
      args,
      startedAt: now - Number(match[3]) * 1000,
      rssBytes: Number(match[4]) * 1024,
    })
  }
  return out
}

/** JSON array from PowerShell: {pid, ppid, name, args, startedAt(ms), rssBytes, cwd?}. */
export function parseProcessJson(json: string): RawProcess[] {
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return []
  }
  const list = Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : []
  return list.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const entry = row as Record<string, unknown>
    const pid = Number(entry.pid)
    if (!Number.isFinite(pid) || pid <= 0) return []
    return [{
      pid,
      ppid: Number(entry.ppid) || 0,
      name: String(entry.name ?? '').replace(/\.exe$/i, ''),
      args: String(entry.args ?? ''),
      startedAt: Number(entry.startedAt) || 0,
      rssBytes: Number(entry.rssBytes) || 0,
      cwd: typeof entry.cwd === 'string' ? entry.cwd : undefined,
    }]
  })
}

export interface HeadlessOptions {
  /** PIDs that belong to DIOS itself; they and their children are never listed. */
  ownPids?: number[]
  /** Working folder lookup, e.g. /proc/<pid>/cwd on Linux. */
  cwdOf?: (pid: number) => string
}

/** Keep the processes that look like forgotten dev servers, excluding DIOS and its children. */
export function headlessProcesses(raw: RawProcess[], options: HeadlessOptions = {}): HeadlessProcess[] {
  const own = new Set(options.ownPids ?? [])
  const byPid = new Map(raw.map((entry) => [entry.pid, entry]))
  const belongsToUs = (entry: RawProcess): boolean => {
    let hop: RawProcess | undefined = entry
    for (let depth = 0; hop && depth < 12; depth += 1) {
      if (own.has(hop.pid)) return true
      hop = byPid.get(hop.ppid)
    }
    return false
  }
  const out: HeadlessProcess[] = []
  for (const entry of raw) {
    const summary = devSummary(entry.args)
    if (!summary || belongsToUs(entry)) continue
    const cwd = entry.cwd ?? (options.cwdOf ? safeCwd(options.cwdOf, entry.pid) : '')
    out.push({ pid: entry.pid, ppid: entry.ppid, name: entry.name, summary, args: entry.args, cwd, startedAt: entry.startedAt, rssBytes: entry.rssBytes, ports: [] })
  }
  // Keep only the top of each process tree so one server does not show as five rows.
  const pids = new Set(out.map((entry) => entry.pid))
  return out.filter((entry) => !pids.has(entry.ppid)).sort((left, right) => left.startedAt - right.startedAt)
}

function safeCwd(lookup: (pid: number) => string, pid: number): string {
  try {
    return lookup(pid)
  } catch {
    return ''
  }
}

/** "2일째 켜져 있어요 · 메모리 320MB". */
export function processLine(entry: HeadlessProcess, now: number = Date.now()): string {
  const parts: string[] = []
  if (entry.startedAt > 0) {
    const minutes = Math.max(0, Math.floor((now - entry.startedAt) / 60000))
    if (minutes < 60) parts.push(`${Math.max(1, minutes)}분째 켜져 있어요`)
    else if (minutes < 60 * 24) parts.push(`${Math.floor(minutes / 60)}시간째 켜져 있어요`)
    else parts.push(`${Math.floor(minutes / 1440)}일째 켜져 있어요`)
  }
  if (entry.rssBytes > 0) parts.push(`메모리 ${Math.max(1, Math.round(entry.rssBytes / 1048576))}MB`)
  if (entry.cwd) parts.push(entry.cwd)
  return parts.join(' · ')
}

/** True when a process has been running for more than a day. */
export function processIsOld(entry: HeadlessProcess, now: number = Date.now()): boolean {
  return entry.startedAt > 0 && now - entry.startedAt > 86_400_000
}
