import { spawn } from 'child_process'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { maskMarkdown, proseHangulRatio, stripTranslationFence, unmaskMarkdown } from './markdown-text'
import { readSavedTranslation, savedTranslationStale, writeSavedTranslation } from './translation-store'

export interface Translation {
  ok: boolean
  message: string
  text: string
}

/** Where to keep the Korean copy. The English skill file stays where it is. */
export interface TranslationSlot {
  home?: string
  placeId: string
  name: string
}

/** Small free model that runs on this computer. It does not call Claude and it does not add a new charge. */
const FREE_MODEL = 'qwen2.5:3b'
const LINE_PREFIX = /^(\s*(?:#{1,6} |[-*+] |\d+\. |> )?)/
const MASK = /⟦\d+⟧/g
const FRONT_MATTER = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/
const OTHER_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/

/**
 * The words of one line that still need Korean.
 * A heading or list mark stays outside the result. Korean lines and code-only lines return null.
 */
export function lineToTranslate(line: string): { prefix: string; body: string } | null {
  const prefix = line.match(LINE_PREFIX)?.[1] ?? ''
  const body = line.slice(prefix.length).trim()
  if (!/[A-Za-z]/.test(body.replace(MASK, ''))) return null
  if (proseHangulRatio(body) >= 0.45) return null
  return { prefix, body }
}

/**
 * Cut one line around its hidden code marks so each English piece is translated on its own.
 * The marks never reach the model, so paths and commands come back untouched.
 */
export function splitAroundMasks(body: string): string[] {
  return body.split(/(⟦\d+⟧)/).filter(Boolean)
}

/**
 * Show the saved Korean copy when this English text was already translated.
 * Otherwise translate one line at a time, save that copy, and leave the English skill file alone.
 */
export async function translateSkillMarkdown(source: string, slot?: TranslationSlot): Promise<Translation> {
  if (proseHangulRatio(source) >= 0.45) {
    return { ok: true, message: '이미 한글이에요. 파일은 그대로예요.', text: source }
  }
  const home = slot?.home || os.homedir()
  if (slot?.name) {
    const saved = readSavedTranslation(home, slot.placeId, slot.name, source)
    if (saved) return { ok: true, message: '저장해 둔 번역본이에요.', text: saved }
  }
  const masked = maskMarkdown(source)
  const stale = slot?.name ? savedTranslationStale(home, slot.placeId, slot.name, source) : false
  const model = await ensureModel()
  if (model !== 'ready') {
    return { ok: false, message: MODEL_MESSAGES[model], text: source }
  }
  try {
    const parts = masked.text.replace(/\r\n/g, '\n').match(FRONT_MATTER)
    const head = parts ? await translateFrontMatter(parts[1]) : ''
    const lines = (parts ? parts[2] : masked.text).split('\n')
    const translated: string[] = []
    for (const line of lines) translated.push(await translateLine(line))
    const restored = unmaskMarkdown(head + stripTranslationFence(translated.join('\n')), masked.slots)
    if (!restored.trim()) return { ok: false, message: '번역 결과가 비어 있어요. 원문을 그대로 보여요.', text: source }
    const text = restored.endsWith('\n') ? restored : `${restored}\n`
    if (slot?.name) writeSavedTranslation(home, slot.placeId, slot.name, source, text)
    const message = stale
      ? '영어 글이 바뀌어서 번역본을 새로 저장했어요. 다음부터는 그 번역본을 보여요.'
      : '번역본을 저장했어요. 다음부터는 다시 번역하지 않아요.'
    return { ok: true, message, text }
  } catch {
    return { ok: false, message: '번역이 중간에 멈췄어요. 번역본을 한 번 더 눌러 주세요.', text: source }
  }
}

/** Only the description sentence in the top block gets Korean. The name and the block itself stay for agents. */
async function translateFrontMatter(block: string): Promise<string> {
  const lines = block.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(description:\s*)(["']?)(.*?)\2\s*$/)
    if (!match || !/[A-Za-z]/.test(match[3])) continue
    const korean = await translatePiece(match[3])
    if (korean) lines[index] = `${match[1]}${JSON.stringify(korean)}`
  }
  return lines.join('\n')
}

async function translateLine(line: string): Promise<string> {
  const piece = lineToTranslate(line)
  if (!piece) return line
  const segments: string[] = []
  for (const segment of splitAroundMasks(piece.body)) {
    if (/^⟦\d+⟧$/.test(segment) || !/[A-Za-z]{3,}/.test(segment)) {
      segments.push(segment)
      continue
    }
    const korean = await translatePiece(segment)
    segments.push(korean ? ` ${korean} ` : segment)
  }
  return `${piece.prefix}${segments.join('').replace(/\s{2,}/g, ' ').trim()}`
}

/** One English sentence to one Korean sentence. Odd answers fall back to the English. */
async function translatePiece(english: string): Promise<string> {
  const answer = await freeTranslate(
    [
      '영어 문장 전체를 자연스러운 한국어 한 문장으로 옮기세요. 한국어만 쓰고, 따옴표 안의 한국어와 제품 이름은 그대로 두세요.',
      'English: Keep the file name as it is.',
      'Korean: 파일 이름은 그대로 두세요.',
      `English: ${english.trim()}`,
      'Korean:',
    ].join('\n'),
  )
  const korean = answer.trim().replace(/^(Korean:|한국어:)\s*/i, '').replace(/\s*\n+\s*/g, ' ').trim()
  if (!korean || OTHER_SCRIPT.test(korean) || !/[가-힣]/.test(korean)) return ''
  if (korean.includes('파일 이름은 그대로 두세요') && !/file name/i.test(english)) return ''
  if (korean.length > english.length * 3 + 20) return ''
  return korean
}

function ollamaBin(): string | null {
  if (process.platform === 'win32') {
    const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe')
    return fs.existsSync(exe) ? exe : null
  }
  return 'ollama'
}

type ModelState = 'ready' | 'no-ollama' | 'down' | 'pulling'

const MODEL_MESSAGES: Record<Exclude<ModelState, 'ready'>, string> = {
  'no-ollama': '번역 프로그램(Ollama)이 이 컴퓨터에 없어요. ollama.com에서 설치하면 번역본을 볼 수 있어요.',
  down: '번역 준비를 못 했어요. 번역본을 한 번 더 눌러 주세요.',
  pulling: '번역 모델을 처음 한 번 내려받고 있어요(약 2GB). 몇 분 뒤 번역본을 다시 눌러 주세요.',
}

/**
 * Start the local model server when it is not answering, and fetch the free model the first time.
 * The Founder never opens a terminal for this.
 */
async function ensureModel(): Promise<ModelState> {
  let names = await installedModels()
  if (!names) {
    const bin = ollamaBin()
    if (!bin) return 'no-ollama'
    const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    for (let attempt = 0; attempt < 16 && !names; attempt += 1) {
      await wait(500)
      names = await installedModels()
    }
    if (!names) return 'down'
  }
  if (names.some((name) => name === FREE_MODEL || name.startsWith(`${FREE_MODEL}:`))) return 'ready'
  startPull()
  return 'pulling'
}

/** Model names the local server has, or null when the server is not answering. */
function installedModels(): Promise<string[] | null> {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null)
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { models?: { name?: string }[] }
          resolve((parsed.models ?? []).map((model) => String(model.name ?? '')))
        } catch {
          resolve([])
        }
      })
    })
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

/** Ask the server to download the free model in the background. The answer is not awaited. */
function startPull(): void {
  const body = JSON.stringify({ name: FREE_MODEL, stream: false })
  const req = http.request({
    hostname: '127.0.0.1',
    port: 11434,
    path: '/api/pull',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => res.resume())
  req.on('error', () => undefined)
  req.end(body)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function freeTranslate(prompt: string): Promise<string> {
  const body = JSON.stringify({
    model: FREE_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.1, num_predict: 240, stop: ['\nEnglish:', '\nKorean:', '\n\n'] },
  })
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { response?: string; error?: string }
          if (!parsed.response?.trim()) reject(new Error(parsed.error || 'empty'))
          else resolve(parsed.response)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(45000, () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
