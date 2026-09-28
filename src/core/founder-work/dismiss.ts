import fs from 'fs'
import path from 'path'
import type { OpenTask } from './parse-gate'

export interface WorkMove {
  ok: boolean
  message: string
  from: string
  to: string
}

/**
 * One line the relay script reads so it knows what the Founder decided in DIOS.
 * `kind` uses the script's words: web = Aside, cli = the Founder.
 */
export interface FounderSignal {
  gateId: string
  project: string
  task: string
  title: string
  kind: 'web' | 'cli'
  file: string
  at: string
  note?: string
}

const FOLDER: Record<'aside' | 'founder', string> = { aside: 'Aside', founder: 'Founder' }
export const SKIP_DIR = '_안함'
export const SKIP_LIST = '안함.jsonl'
export const RESULT_DIR = '_결과'

export function signalFor(task: OpenTask, note?: string): FounderSignal {
  return {
    gateId: task.gateId,
    project: task.project,
    task: task.task,
    title: task.title,
    kind: task.kind === 'aside' ? 'web' : 'cli',
    file: task.fileName,
    at: new Date().toISOString(),
    ...(note ? { note } : {}),
  }
}

/**
 * Take one open task off the list for good. The file moves under 00_NOW/_안함 and a line is added
 * to 안함.jsonl, so the relay script does not send the same task again.
 */
export function dismissOpenFile(root: string, task: OpenTask): WorkMove {
  const base = safeBase(task.fileName)
  if (!root || !base) return fail('이 파일은 지울 수 없어요.')
  const from = path.join(root, '00_NOW', FOLDER[task.kind], base)
  if (!inside(root, from) || !isFile(from)) return fail('이미 목록에 없어요.')
  const toDir = path.join(root, '00_NOW', SKIP_DIR, FOLDER[task.kind])
  const to = uniquePath(path.join(toDir, base))
  fs.mkdirSync(toDir, { recursive: true })
  fs.renameSync(from, to)
  appendSignal(path.join(root, '00_NOW', SKIP_DIR, SKIP_LIST), signalFor(task))
  return { ok: true, message: '이 일을 목록에서 뺐어요. 같은 일은 다시 오지 않아요.', from, to }
}

/** Put a dismissed file back and forget the 안함 line. */
export function restoreOpenFile(root: string, task: OpenTask, from: string, to: string): WorkMove {
  if (!from || !to || !fs.existsSync(to)) return fail('되돌릴 파일을 찾지 못했어요.')
  if (fs.existsSync(from)) return fail('같은 이름의 일이 다시 와서, 되돌리지 않았어요.')
  fs.mkdirSync(path.dirname(from), { recursive: true })
  fs.renameSync(to, from)
  removeSignal(path.join(root, '00_NOW', SKIP_DIR, SKIP_LIST), task)
  return { ok: true, message: '다시 목록에 넣었어요.', from, to: from }
}

/**
 * The Founder pasted the result in DIOS. The task file moves to the DONE archive with a RESULT.md,
 * and a small result file is left for the relay script so the named agent learns about it.
 */
export function finishOpenFile(root: string, task: OpenTask, note: string): WorkMove {
  const base = safeBase(task.fileName)
  if (!root || !base) return fail('이 파일은 옮길 수 없어요.')
  const from = path.join(root, '00_NOW', FOLDER[task.kind], base)
  if (!inside(root, from) || !isFile(from)) return fail('이미 목록에 없어요.')
  const day = localDay()
  const dir = path.join(root, '01_ARCHIVE', safeSeg(task.project), 'DONE', day, safeSeg(task.task || task.title))
  fs.mkdirSync(dir, { recursive: true })
  const to = uniquePath(path.join(dir, base))
  fs.renameSync(from, to)
  const clean = note.trim() || '대표님이 DIOS에서 끝냈다고 표시했어요.'
  fs.writeFileSync(path.join(dir, 'RESULT.md'), resultText(task, clean), 'utf8')
  const resultDir = path.join(root, '00_NOW', RESULT_DIR)
  fs.mkdirSync(resultDir, { recursive: true })
  const signal = signalFor(task, clean)
  fs.writeFileSync(path.join(resultDir, `${resultName(task)}.json`), `${JSON.stringify(signal, null, 2)}\n`, 'utf8')
  return { ok: true, message: '끝난 일로 옮겼어요. 시킨 에이전트에게도 전해져요.', from, to }
}

/** Bring a finished task back to the open list. The result note and the relay signal are dropped. */
export function unfinishOpenFile(root: string, task: OpenTask, from: string, to: string): WorkMove {
  if (!from || !to || !fs.existsSync(to)) return fail('되돌릴 파일을 찾지 못했어요.')
  if (fs.existsSync(from)) return fail('같은 이름의 일이 다시 와서, 되돌리지 않았어요.')
  fs.mkdirSync(path.dirname(from), { recursive: true })
  fs.renameSync(to, from)
  const dir = path.dirname(to)
  fs.rmSync(path.join(dir, 'RESULT.md'), { force: true })
  fs.rmSync(path.join(root, '00_NOW', RESULT_DIR, `${resultName(task)}.json`), { force: true })
  try {
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir)
  } catch {
    // An archive folder that is not empty stays.
  }
  return { ok: true, message: '다시 할 일로 되돌렸어요.', from, to: from }
}

function resultText(task: OpenTask, note: string): string {
  return [
    `# DONE · ${task.gateId || task.title}`,
    `작업: ${task.title}`,
    `프로젝트: ${task.project}`,
    '',
    '## Agent가 받은 결과 보고',
    note,
    '',
    '대표님이 DIOS 지금 할 일 화면에서 끝냈어요.',
    '',
  ].join('\n')
}

function resultName(task: OpenTask): string {
  return task.gateId || safeSeg(`${task.project}-${task.title}`)
}

function appendSignal(file: string, signal: FounderSignal): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(signal)}\n`, 'utf8')
}

function removeSignal(file: string, task: OpenTask): void {
  if (!fs.existsSync(file)) return
  const kept = fs.readFileSync(file, 'utf8').split('\n').filter((line) => {
    if (!line.trim()) return false
    try {
      const entry = JSON.parse(line) as FounderSignal
      return !(entry.file === task.fileName || (task.gateId && entry.gateId === task.gateId))
    } catch {
      return true
    }
  })
  fs.writeFileSync(file, kept.length ? `${kept.join('\n')}\n` : '', 'utf8')
}

/** Same rule as the relay script's safe_seg: Korean, letters, digits, _ and - only. */
export function safeSeg(text: string): string {
  const flat = (text || '기타').trim().replace(/\s+/g, '_').replace(/[^0-9A-Za-z가-힣_-]/g, '')
  return (flat.slice(0, 60) || '이름없음').replace(/^[_-]+|[_-]+$/g, '') || '이름없음'
}

function localDay(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function safeBase(fileName: string): string {
  const base = path.basename(fileName)
  if (!base || base !== fileName || !base.toLowerCase().endsWith('.md')) return ''
  if (base.toLowerCase() === 'readme.md' || base.startsWith('.')) return ''
  return base
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

function inside(root: string, target: string): boolean {
  const base = path.resolve(root)
  const full = path.resolve(target)
  return full === base || full.startsWith(base + path.sep)
}

function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target
  const ext = path.extname(target)
  const stem = target.slice(0, -ext.length)
  for (let n = 2; n < 100; n += 1) {
    const next = `${stem}-${n}${ext}`
    if (!fs.existsSync(next)) return next
  }
  return `${stem}-${Date.now()}${ext}`
}

function fail(message: string): WorkMove {
  return { ok: false, message, from: '', to: '' }
}
