import { execFile, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

/** One computer or environment whose skills the board can show. */
export interface Place {
  id: string
  name: string
  kind: 'local' | 'wsl' | 'ssh'
  /** WSL distro name or SSH host alias. Empty for local. */
  target: string
}

export interface RemoteFailure {
  message: string
}

const SKIP_WSL = /^(docker-desktop|rancher-desktop|podman)/i
const CONNECT_TIMEOUT_SEC = 8
const RUN_TIMEOUT_MS = 40000

/**
 * Local first, then WSL distros (Windows only), then SSH hosts from ~/.ssh/config.
 * Nothing is contacted here. A place is only reached when the Founder opens its tab.
 */
export async function listPlaces(home: string, platform: NodeJS.Platform = process.platform): Promise<Place[]> {
  const places: Place[] = [{ id: 'local', name: '이 컴퓨터', kind: 'local', target: '' }]
  if (platform === 'win32') {
    for (const distro of await listWslDistros()) {
      places.push({ id: `wsl:${distro}`, name: `${distro} (WSL)`, kind: 'wsl', target: distro })
    }
  }
  for (const host of readSshHosts(path.join(home, '.ssh', 'config'))) {
    places.push({ id: `ssh:${host}`, name: `${host} (SSH)`, kind: 'ssh', target: host })
  }
  return places
}

/** Find a place by id or return null. Ids come from the renderer, so they are checked here. */
export async function findPlace(home: string, placeId: string): Promise<Place | null> {
  const places = await listPlaces(home)
  return places.find((place) => place.id === placeId) ?? null
}

/**
 * Run the bundled Python helper on a remote place and return its JSON text.
 * On SSH the first try is python3. Windows hosts fall back to the py launcher.
 */
export async function runRemote(place: Place, args: string[], script: string): Promise<string> {
  if (place.kind === 'wsl') {
    return runOnce('wsl.exe', ['-d', place.target, '--', 'python3', '-', ...args], script, place)
  }
  if (place.kind === 'ssh') {
    const base = ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${CONNECT_TIMEOUT_SEC}`, place.target]
    try {
      return await runOnce('ssh', [...base, 'python3', '-', ...args], script, place)
    } catch (error) {
      if (!looksLikeMissingPython(error)) throw error
      return runOnce('ssh', [...base, 'py', '-3', '-', ...args], script, place)
    }
  }
  throw new Error('이 컴퓨터는 원격으로 다루지 않아요.')
}

/** Leave a JSON payload on the other computer for the next helper command to read. */
export async function stagePack(place: Place, json: string): Promise<void> {
  const writer = 'import pathlib,sys; pathlib.Path.home().joinpath(".dios-pack.json").write_bytes(sys.stdin.buffer.read())'
  if (place.kind === 'wsl') {
    await runOnce('wsl.exe', ['-d', place.target, '--', 'python3', '-c', writer], json, place)
    return
  }
  if (place.kind === 'ssh') {
    const base = ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${CONNECT_TIMEOUT_SEC}`, place.target]
    try {
      await runOnce('ssh', [...base, 'python3', '-c', writer], json, place)
    } catch (error) {
      if (!looksLikeMissingPython(error)) throw error
      await runOnce('ssh', [...base, 'py', '-3', '-c', writer], json, place)
    }
    return
  }
  throw new Error('이 컴퓨터는 원격으로 다루지 않아요.')
}

/** Parse Host lines from an OpenSSH config, skipping wildcard patterns. */
export function parseSshHosts(text: string): string[] {
  const hosts: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const match = line.match(/^Host\s+(.+)$/i)
    if (!match) continue
    for (const name of match[1].split(/\s+/)) {
      if (!name || /[*?!]/.test(name) || hosts.includes(name)) continue
      hosts.push(name)
    }
  }
  return hosts
}

/** Turn a process failure into one Korean line the Founder can act on. */
export function explainFailure(place: Place, error: unknown): string {
  const text = String((error as { message?: string })?.message ?? error)
  if (/timed out|Connection timed out|Operation timed out|ETIMEDOUT/i.test(text)) {
    return `${place.name}이(가) 꺼져 있거나 네트워크가 끊겼어요.`
  }
  if (/Permission denied|publickey|Host key verification/i.test(text)) {
    return `${place.name}에 열쇠 없이 들어갈 수 없어요. 터미널에서 한 번 접속해 두면 돼요.`
  }
  if (/python3|py\b|not found|찾을 수 없/i.test(text)) {
    return `${place.name}에 python3가 없어요.`
  }
  if (/ENOENT.*wsl|wsl\.exe/i.test(text) || /There is no distribution/i.test(text)) {
    return `${place.name}이(가) 아직 켜지지 않았어요.`
  }
  return `${place.name}에서 답을 받지 못했어요.`
}

function readSshHosts(file: string): string[] {
  try {
    return parseSshHosts(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

function listWslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('wsl.exe', ['-l', '-q'], { encoding: 'buffer', timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve([])
      const text = decodeWsl(stdout)
      resolve(text.split(/\r?\n/).map((line) => line.replace(/\0/g, '').trim()).filter((line) => line && !SKIP_WSL.test(line)))
    })
  })
}

function decodeWsl(buffer: Buffer): string {
  const hasNulls = buffer.length > 1 && buffer[1] === 0
  return hasNulls ? buffer.toString('utf16le') : buffer.toString('utf8')
}

function looksLikeMissingPython(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error)
  return /python3|not recognized|not found|Microsoft Store|찾을 수 없/i.test(text)
}

function runOnce(command: string, args: string[], input: string, place: Place): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${place.name}: timed out`))
    }, RUN_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { out += chunk })
    child.stderr.on('data', (chunk: string) => { err += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`${place.name}: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const jsonStart = out.indexOf('{')
      if (code === 0 && jsonStart >= 0) return resolve(out.slice(jsonStart))
      reject(new Error(`${place.name}: exit ${code ?? '?'} ${err.trim() || out.trim()}`))
    })
    child.stdin.on('error', () => { /* the close handler reports the real reason */ })
    child.stdin.end(input)
  })
}
