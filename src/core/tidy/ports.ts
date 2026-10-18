import type { RawProcess } from './background-jobs'
import type { HeadlessProcess, PortOverlap } from './types'

/** Listening TCP ports per process id. */
export type PortsByPid = Map<number, number[]>

function addPort(map: PortsByPid, pid: number, port: number): void {
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(port) || port <= 0) return
  const list = map.get(pid) ?? []
  if (!list.includes(port)) list.push(port)
  map.set(pid, list.sort((left, right) => left - right))
}

/** The port at the end of "127.0.0.1:5173", "[::]:5173", "*:5173"; 0 when there is none. */
function portOf(address: string): number {
  const match = /:(\d+)$/.exec(address.trim())
  return match ? Number(match[1]) : 0
}

/**
 * Linux `ss -ltnp`. One line per socket, e.g.
 * `LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4445,fd=26))`.
 * Header lines and sockets without a visible owner are skipped.
 */
export function parseSsListen(text: string): PortsByPid {
  const map: PortsByPid = new Map()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('LISTEN')) continue
    const columns = line.split(/\s+/)
    if (columns.length < 4) continue
    const port = portOf(columns[3])
    const pids = [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]))
    for (const pid of pids) addPort(map, pid, port)
  }
  return map
}

/**
 * macOS `lsof -nP -iTCP -sTCP:LISTEN`. Columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME,
 * where NAME looks like `*:5173 (LISTEN)`.
 */
export function parseLsofListen(text: string): PortsByPid {
  const map: PortsByPid = new Map()
  for (const raw of text.split(/\r?\n/)) {
    const columns = raw.trim().split(/\s+/)
    if (columns.length < 8 || !/^\d+$/.test(columns[1])) continue
    const name = columns[columns.length - 1] === '(LISTEN)' ? columns[columns.length - 2] : columns[columns.length - 1]
    addPort(map, Number(columns[1]), portOf(name))
  }
  return map
}

/**
 * Windows PowerShell `Get-NetTCPConnection -State Listen | Select-Object LocalPort, OwningProcess | ConvertTo-Json`.
 * One object or an array of `{ LocalPort, OwningProcess }`.
 */
export function parseNetTcpJson(json: string): PortsByPid {
  const map: PortsByPid = new Map()
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return map
  }
  const list = Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const entry = row as Record<string, unknown>
    addPort(map, Number(entry.OwningProcess ?? entry.owningProcess), Number(entry.LocalPort ?? entry.localPort))
  }
  return map
}

/** Drops the "· 포트 N" guess that devSummary read from the command line. */
function withoutPortGuess(summary: string): string {
  return summary.replace(/\s*·\s*포트\s+[\d, ]+$/, '')
}

/**
 * Gives each listed program the ports it or any child is listening on. The list only keeps the
 * top of each process tree (npm → vite), so the child's port has to be counted for the parent.
 * When the OS reported ports, they replace the port guessed from the command line.
 */
export function withPorts(processes: HeadlessProcess[], raw: RawProcess[], ports: PortsByPid): HeadlessProcess[] {
  const children = new Map<number, number[]>()
  for (const entry of raw) {
    const list = children.get(entry.ppid) ?? []
    list.push(entry.pid)
    children.set(entry.ppid, list)
  }
  const subtreePorts = (root: number): number[] => {
    const found = new Set<number>()
    const queue = [root]
    const seen = new Set<number>()
    while (queue.length) {
      const pid = queue.shift() as number
      if (seen.has(pid)) continue
      seen.add(pid)
      for (const port of ports.get(pid) ?? []) found.add(port)
      for (const child of children.get(pid) ?? []) queue.push(child)
    }
    return [...found].sort((left, right) => left - right)
  }
  return processes.map((proc) => {
    const list = subtreePorts(proc.pid)
    if (!list.length) return { ...proc, ports: [] }
    return { ...proc, ports: list, summary: `${withoutPortGuess(proc.summary)} · 포트 ${list.join(', ')}` }
  })
}

/**
 * Programs in each other's way. Two programs on one port happen when one listens on IPv4 and
 * another on IPv6, or after a crash left a child behind. Two programs from one folder is the
 * everyday case: a dev server started twice, the second one pushed to the next port.
 */
export function findOverlaps(processes: HeadlessProcess[]): PortOverlap[] {
  const out: PortOverlap[] = []
  const byPort = new Map<number, number[]>()
  for (const proc of processes) {
    for (const port of proc.ports) {
      const list = byPort.get(port) ?? []
      if (!list.includes(proc.pid)) list.push(proc.pid)
      byPort.set(port, list)
    }
  }
  for (const [port, pids] of [...byPort.entries()].sort((left, right) => left[0] - right[0])) {
    if (pids.length > 1) out.push({ kind: 'same-port', port, cwd: '', pids })
  }
  const byFolder = new Map<string, number[]>()
  for (const proc of processes) {
    if (!proc.cwd) continue
    const list = byFolder.get(proc.cwd) ?? []
    list.push(proc.pid)
    byFolder.set(proc.cwd, list)
  }
  for (const [cwd, pids] of [...byFolder.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (pids.length > 1) out.push({ kind: 'same-folder', port: 0, cwd, pids })
  }
  return out
}

/** Pids that appear in any overlap, so a row can carry a 겹침 tag. */
export function overlappingPids(overlaps: PortOverlap[]): Set<number> {
  return new Set(overlaps.flatMap((group) => group.pids))
}

/**
 * What buildTidyReport does with a port read. A failed read keeps the process list,
 * clears ports, and reports no overlaps, so the rest of the tidy screen still opens.
 */
export interface PortCollection {
  ok: boolean
  ports: PortsByPid
}

export interface PortAttachment {
  processes: HeadlessProcess[]
  overlaps: PortOverlap[]
  /** Plain Korean note when the read failed; '' when it worked or there was nothing to read. */
  note: string
}

/**
 * Attaches listening ports and finds overlaps. Failure degrades to empty ports
 * instead of dropping the process list.
 */
export function applyPortCollection(processes: HeadlessProcess[], raw: RawProcess[], collection: PortCollection): PortAttachment {
  if (!collection.ok) {
    return {
      processes: processes.map((proc) => ({ ...proc, ports: [] })),
      overlaps: [],
      note: '프로그램이 쓰는 포트를 읽지 못했어요. 겹치는지는 이번엔 못 봤어요.',
    }
  }
  const listed = withPorts(processes, raw, collection.ports)
  return { processes: listed, overlaps: findOverlaps(listed), note: '' }
}

/** One plain Korean sentence per overlap, naming what is shared and what to do. */
export function overlapLine(group: PortOverlap, processes: HeadlessProcess[]): string {
  const rows = processes.filter((proc) => group.pids.includes(proc.pid))
  const count = group.pids.length
  if (group.kind === 'same-port') {
    return `포트 ${group.port}을(를) 프로그램 ${count}개가 같이 잡고 있어요. 하나는 예전에 켜 두고 잊은 것일 수 있어요. 오래된 것부터 끄면 돼요.`
  }
  const folder = group.cwd.split(/[\\/]/).filter(Boolean).pop() || group.cwd
  const ports = [...new Set(rows.flatMap((proc) => proc.ports))].sort((left, right) => left - right)
  const portText = ports.length > 1 ? ` 포트가 ${ports.join(', ')}로 갈라졌어요.` : ''
  return `${folder} 폴더에서 ${count}개가 켜져 있어요.${portText} 먼저 켠 것이 자리를 잡고 있어서 나중 것은 다른 포트로 밀렸을 수 있어요. 오래된 것부터 끄면 돼요.`
}
