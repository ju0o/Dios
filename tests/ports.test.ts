import { describe, expect, it } from 'vitest'
import type { RawProcess } from '../src/core/tidy/background-jobs'
import {
  applyPortCollection,
  findOverlaps,
  overlapLine,
  parseLsofListen,
  parseNetTcpJson,
  parseSsListen,
  withPorts,
} from '../src/core/tidy/ports'
import type { HeadlessProcess } from '../src/core/tidy/types'

function proc(partial: Partial<HeadlessProcess> & Pick<HeadlessProcess, 'pid'>): HeadlessProcess {
  return {
    ppid: 0,
    name: 'node',
    summary: 'vite',
    args: '',
    cwd: '',
    startedAt: 0,
    rssBytes: 0,
    ports: [],
    ...partial,
  }
}

function raw(pid: number, ppid: number): RawProcess {
  return { pid, ppid, name: 'node', args: '', startedAt: 0, rssBytes: 0 }
}

describe('listening port parsers', () => {
  it('reads one Linux socket, several ports, and skips rows with no owner', () => {
    const text = [
      'State Recv-Q Send-Q Local Address:Port Peer Address:PortProcess',
      'LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4445,fd=26))',
      'LISTEN 0 511 *:3000 0.0.0.0:* users:(("node",pid=4445,fd=27))',
      'LISTEN 0 511 [::]:8080 [::]:* users:(("caddy",pid=9,fd=3),("caddy",pid=10,fd=3))',
      'LISTEN 0 511 127.0.0.1:9 0.0.0.0:*',
      'ESTAB 0 0 127.0.0.1:1 127.0.0.1:2',
      '',
    ].join('\n')
    const map = parseSsListen(text)
    expect(map.get(4445)).toEqual([3000, 5173])
    expect(map.get(9)).toEqual([8080])
    expect(map.get(10)).toEqual([8080])
    expect(map.has(0)).toBe(false)
  })

  it('returns an empty map for empty or malformed ss output', () => {
    expect(parseSsListen('').size).toBe(0)
    expect(parseSsListen('not a table\nLISTEN\nLISTEN 0').size).toBe(0)
  })

  it('reads lsof listen rows and ignores the header', () => {
    const text = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'node 4445 me 26u IPv4 0x1 0t0 TCP 127.0.0.1:5173 (LISTEN)',
      'node 4445 me 27u IPv6 0x2 0t0 TCP *:5174 (LISTEN)',
      'short line',
    ].join('\n')
    expect(parseLsofListen(text).get(4445)).toEqual([5173, 5174])
    expect(parseLsofListen('').size).toBe(0)
  })

  it('reads Windows JSON as one object or a list, and ignores garbage', () => {
    expect(parseNetTcpJson('{"LocalPort":5173,"OwningProcess":4}').get(4)).toEqual([5173])
    const many = parseNetTcpJson('[{"LocalPort":1,"OwningProcess":2},{"localPort":3,"owningProcess":2},{"LocalPort":0,"OwningProcess":2}]')
    expect(many.get(2)).toEqual([1, 3])
    expect(parseNetTcpJson('').size).toBe(0)
    expect(parseNetTcpJson('{not json').size).toBe(0)
    expect(parseNetTcpJson('null').size).toBe(0)
    expect(parseNetTcpJson('[]').size).toBe(0)
  })
})

describe('withPorts', () => {
  it('counts a child listener on the parent row and replaces the guessed port', () => {
    const processes = [proc({ pid: 1, summary: 'vite dev · 포트 9999' })]
    const listed = withPorts(processes, [raw(1, 0), raw(2, 1)], new Map([[2, [5173, 5174]]]))
    expect(listed[0].ports).toEqual([5173, 5174])
    expect(listed[0].summary).toBe('vite dev · 포트 5173, 5174')
  })

  it('leaves a process with no matching pid on empty ports', () => {
    const listed = withPorts([proc({ pid: 9, summary: 'vite' })], [raw(9, 0)], new Map([[3, [80]]]))
    expect(listed[0].ports).toEqual([])
    expect(listed[0].summary).toBe('vite')
  })
})

describe('findOverlaps', () => {
  it('finds nothing when every program has its own port and folder', () => {
    const processes = [
      proc({ pid: 1, ports: [3000], cwd: '/a' }),
      proc({ pid: 2, ports: [3001], cwd: '/b' }),
    ]
    expect(findOverlaps(processes)).toEqual([])
  })

  it('finds one shared port', () => {
    const processes = [
      proc({ pid: 1, ports: [3000] }),
      proc({ pid: 2, ports: [3000] }),
    ]
    expect(findOverlaps(processes)).toEqual([{ kind: 'same-port', port: 3000, cwd: '', pids: [1, 2] }])
  })

  it('finds several shared ports and a shared folder', () => {
    const processes = [
      proc({ pid: 1, ports: [3000], cwd: '/app' }),
      proc({ pid: 2, ports: [3000], cwd: '/app' }),
      proc({ pid: 3, ports: [4000], cwd: '/other' }),
      proc({ pid: 4, ports: [4000], cwd: '' }),
    ]
    expect(findOverlaps(processes)).toEqual([
      { kind: 'same-port', port: 3000, cwd: '', pids: [1, 2] },
      { kind: 'same-port', port: 4000, cwd: '', pids: [3, 4] },
      { kind: 'same-folder', port: 0, cwd: '/app', pids: [1, 2] },
    ])
  })

  it('counts one process once when the same port is repeated', () => {
    const processes = [
      proc({ pid: 1, ports: [3000, 3000] }),
      proc({ pid: 1, ports: [3000] }),
      proc({ pid: 2, ports: [3000] }),
    ]
    expect(findOverlaps(processes)).toEqual([{ kind: 'same-port', port: 3000, cwd: '', pids: [1, 2] }])
  })

  it('says in plain Korean what is shared', () => {
    const processes = [
      proc({ pid: 1, ports: [3000], cwd: '/work/Dios', summary: 'vite' }),
      proc({ pid: 2, ports: [5173], cwd: '/work/Dios', summary: 'vite' }),
    ]
    const [folder] = findOverlaps(processes)
    expect(overlapLine(folder, processes)).toContain('Dios 폴더에서 2개가 켜져 있어요')
    expect(overlapLine(folder, processes)).toContain('포트가 3000, 5173로 갈라졌어요')
    const shared = findOverlaps([
      proc({ pid: 1, ports: [3000] }),
      proc({ pid: 2, ports: [3000] }),
    ])[0]
    expect(overlapLine(shared, [])).toBe('포트 3000을(를) 프로그램 2개가 같이 잡고 있어요. 하나는 예전에 켜 두고 잊은 것일 수 있어요. 오래된 것부터 끄면 돼요.')
  })
})

describe('buildTidyReport port attachment', () => {
  it('fills overlaps from a successful listen read', () => {
    const processes = [proc({ pid: 1, summary: 'vite' }), proc({ pid: 2, summary: 'vite' })]
    const attached = applyPortCollection(processes, [raw(1, 0), raw(2, 0)], {
      ok: true,
      ports: new Map([[1, [3000]], [2, [3000]]]),
    })
    expect(attached.note).toBe('')
    expect(attached.processes.map((row) => row.ports)).toEqual([[3000], [3000]])
    expect(attached.overlaps).toEqual([{ kind: 'same-port', port: 3000, cwd: '', pids: [1, 2] }])
  })

  it('keeps the process list and an empty overlap list when the read fails', () => {
    const processes = [proc({ pid: 1, ports: [5173], summary: 'vite · 포트 5173' })]
    const attached = applyPortCollection(processes, [raw(1, 0)], { ok: false, ports: new Map() })
    expect(attached.processes).toHaveLength(1)
    expect(attached.processes[0].ports).toEqual([])
    expect(attached.processes[0].summary).toBe('vite · 포트 5173')
    expect(attached.overlaps).toEqual([])
    expect(attached.note).toContain('포트를 읽지 못했어요')
  })
})
