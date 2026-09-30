import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

/** Result of one hidden command. Code is null when the process never reported one. */
export interface QuietResult {
  code: number | null
  stdout: string
  stderr: string
}

interface QuietHost {
  /** True when DIOS is the window the Founder is looking at, or it just opened. */
  wasFocused(): boolean
  /** Bring DIOS forward after a background program tried to take the screen. */
  pullForward(): void
}

const NO_HOST: QuietHost = { wasFocused: () => false, pullForward: () => undefined }

let host: QuietHost = NO_HOST

/**
 * Let the desktop app pull its own window forward.
 * Tests and the command line leave this unset.
 */
export function setQuietHost(next: QuietHost): void {
  host = next
}

/** Quote one argument for cmd.exe and WScript.Shell.Run. */
export function cmdArg(value: string): string {
  if (!value) return '""'
  if (!/[\s"&|<>^%]/.test(value)) return value
  let out = '"'
  let slashes = 0
  for (const char of value) {
    if (char === '\\') {
      slashes += 1
      continue
    }
    if (char === '"') {
      out += `${'\\'.repeat(slashes * 2 + 1)}"`
      slashes = 0
      continue
    }
    if (slashes) {
      out += '\\'.repeat(slashes)
      slashes = 0
    }
    out += char
  }
  if (slashes) out += '\\'.repeat(slashes * 2)
  return `${out}"`
}

/** One command line, with optional files for input and output. No extra window. */
export function hiddenCommandLine(command: string, args: string[], files?: { stdin?: string; stdout?: string; stderr?: string; cwd?: string }): string {
  let line = [cmdArg(command), ...args.map(cmdArg)].join(' ')
  if (files?.stdin) line += ` < ${cmdArg(files.stdin)}`
  if (files?.stdout) line += ` > ${cmdArg(files.stdout)}`
  if (files?.stderr) line += ` 2> ${cmdArg(files.stderr)}`
  if (files?.cwd) line = `cd /d ${cmdArg(files.cwd)} && ${line}`
  return line
}

/**
 * Script that starts a program with window style 0 (hidden, no focus).
 * Style 0 is what keeps a console from covering DIOS. Waiting is false so a long run stays in the background.
 */
export function hiddenLaunchScript(command: string, args: string[]): string {
  const line = hiddenCommandLine(command, args)
  return [
    'Set sh = CreateObject("Wscript.Shell")',
    `sh.Run ${vbsString(line)}, 0, False`,
    '',
  ].join('\r\n')
}

/** Run one command line through a hidden cmd, wait, and keep Unicode paths in an environment variable. */
export function hiddenCaptureScript(line: string): string {
  const cmd = winExe('cmd.exe')
  return [
    'Set sh = CreateObject("Wscript.Shell")',
    `sh.Environment("Process")("DIOS_LINE") = ${vbsString(line)}`,
    `sh.Run ${vbsString(`${cmd} /d /s /c "%DIOS_LINE%"`)}, 0, True`,
    '',
  ].join('\r\n')
}

/**
 * Start a long-running program without a window.
 * On Windows this does not use a detached console, which is what was covering DIOS during translation.
 */
export function startHidden(command: string, args: string[]): void {
  // A missing program must not become an uncaught 'error' event: Electron would answer with a modal
  // error box on the main thread and the whole app would freeze behind it.
  if (process.platform !== 'win32') {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
    return
  }
  launchVbs(hiddenLaunchScript(command, args), () => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore', shell: false })
    child.on('error', () => undefined)
    child.unref()
  })
  nudgeSoon()
}

/** Run a command, collect its text, and do not leave a window in front of DIOS. */
export function runQuiet(command: string, args: string[], input = '', options: { cwd?: string; timeoutMs?: number } = {}): Promise<QuietResult> {
  const timeoutMs = options.timeoutMs ?? 40000
  if (process.platform !== 'win32') return runPiped(command, args, input, options.cwd, timeoutMs)
  return runWindows(command, args, input, options.cwd, timeoutMs)
}

function vbsString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function winExe(name: string): string {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name)
}

function nudgeSoon(): void {
  if (!host.wasFocused()) return
  host.pullForward()
  setTimeout(() => host.pullForward(), 400)
  setTimeout(() => host.pullForward(), 1100)
}

function writeVbs(file: string, body: string): void {
  const bom = Buffer.from([0xff, 0xfe])
  fs.writeFileSync(file, Buffer.concat([bom, Buffer.from(body, 'utf16le')]))
}

function launchVbs(body: string, onMissing?: () => void): ChildProcess | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-q-'))
  const file = path.join(dir, 'run.vbs')
  writeVbs(file, body)
  const child = spawn(winExe('wscript.exe'), ['//B', '//Nologo', file], { windowsHide: true, stdio: 'ignore' })
  child.on('error', () => {
    onMissing?.()
  })
  child.on('exit', () => {
    fs.rm(dir, { recursive: true, force: true }, () => undefined)
  })
  return child
}

function runWindows(command: string, args: string[], input: string, cwd: string | undefined, timeoutMs: number): Promise<QuietResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-q-'))
  const stdin = path.join(dir, 'in.txt')
  const stdout = path.join(dir, 'out.txt')
  const stderr = path.join(dir, 'err.txt')
  const file = path.join(dir, 'run.vbs')
  fs.writeFileSync(stdin, input)
  const line = hiddenCommandLine(command, args, { stdin, stdout, stderr, cwd })
  writeVbs(file, hiddenCaptureScript(line))
  nudgeSoon()
  return new Promise((resolve, reject) => {
    const child = spawn(winExe('wscript.exe'), ['//B', '//Nologo', file], { windowsHide: true, stdio: 'ignore' })
    let settled = false
    const finish = (result: QuietResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fs.rm(dir, { recursive: true, force: true }, () => undefined)
      resolve(result)
    }
    let failed = false
    const timer = setTimeout(() => {
      if (child.pid) {
        const killer = spawn(winExe('taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => undefined)
        killer.unref()
      }
      child.kill()
      if (!settled) {
        settled = true
        fs.rm(dir, { recursive: true, force: true }, () => undefined)
        reject(new Error('timed out'))
      }
    }, timeoutMs)
    child.on('error', () => {
      failed = true
      clearTimeout(timer)
      if (settled) return
      settled = true
      runPiped(command, args, input, cwd, timeoutMs).then((result) => {
        fs.rm(dir, { recursive: true, force: true }, () => undefined)
        resolve(result)
      }).catch((error) => {
        fs.rm(dir, { recursive: true, force: true }, () => undefined)
        reject(error)
      })
    })
    child.on('exit', (code) => {
      if (failed) return
      finish({
        code,
        stdout: readText(stdout),
        stderr: readText(stderr),
      })
    })
  })
}

function runPiped(command: string, args: string[], input: string, cwd: string | undefined, timeoutMs: number): Promise<QuietResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('timed out'))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
