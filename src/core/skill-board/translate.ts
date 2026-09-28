import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { lineToTranslate, maskMarkdown, patchDescription, patchVisibleLine, proseHangulRatio, splitSkillText, stripTranslationFence, unmaskMarkdown } from './markdown-text'
import { isBrokenTranslation, isRepetitive, proseBlocks, summaryOk } from './translation-quality'
import { startHidden } from './quiet-process'
import { readSavedTranslationMeta, savedTranslationStale, writeSavedTranslation } from './translation-store'

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

/**
 * Free models that run on this computer. The larger one reads far better Korean; the small one is the
 * first-day fallback while the larger one downloads. Neither calls Claude or adds a charge.
 */
const BETTER_MODEL = 'qwen2.5:7b'
const SMALL_MODEL = 'qwen2.5:3b'

export { lineToTranslate } from './markdown-text'
const OTHER_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/
const ENGLISH_WORD = /[A-Za-z][A-Za-z'’-]{3,}/g

const SYSTEM_PROMPT = [
  '당신은 영어 스킬 문서를 한국어로 옮기는 번역가입니다.',
  '규칙:',
  '1. 번역문만 출력합니다. 설명, 따옴표, 머리말을 붙이지 않습니다.',
  '2. 한자, 일본어, 중국어는 쓰지 않습니다.',
  '3. 같은 문장을 반복하지 않습니다. 원문에 없는 내용을 지어내지 않습니다.',
  '4. 제품 이름, 사람 이름, 명령어, 파일 이름, 코드는 원문 그대로 둡니다.',
  '5. 설명은 "~해요"로, 시키는 말은 "~하세요"로 자연스럽게 씁니다.',
].join('\n')

const KEEP_WORDS = new Set(['api', 'url', 'ssh', 'json', 'yaml', 'readme', 'http', 'https', 'html', 'css', 'sql', 'wsl', 'ollama', 'github', 'claude', 'codex', 'cursor', 'grok', 'aside', 'dios'])

/**
 * Words the source keeps as names or commands (Capitalized, ALLCAPS, with digits or dots) may stay in the Korean.
 * Ordinary lowercase words like "keep" or "tests" must be translated.
 */
function latinWords(text: string): Set<string> {
  const names = (text.match(ENGLISH_WORD) ?? []).filter((word) => /^[A-Z]/.test(word) || /[\d._-]/.test(word) || word === word.toUpperCase())
  return new Set([...names.map((word) => word.toLowerCase()), ...KEEP_WORDS])
}

/** English words in the answer that the source did not have: the model skipped translating them. */
export function leftoverEnglish(english: string, korean: string): string[] {
  const allowed = latinWords(english)
  return [...new Set((korean.match(ENGLISH_WORD) ?? []).map((word) => word.toLowerCase()))].filter((word) => !allowed.has(word))
}

/** Share of letters (not spaces, digits, marks) that are Hangul. */
export function hangulShare(text: string): number {
  const letters = [...text].filter((char) => /[\p{L}]/u.test(char))
  if (!letters.length) return 0
  return letters.filter((char) => /[가-힣]/.test(char)).length / letters.length
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
  const loaded = slot?.name ? readSavedTranslationMeta(home, slot.placeId, slot.name, source) : null
  // A copy that repeats itself or mixes in Chinese is not kept. The next open translates it again.
  const saved = loaded && !isBrokenTranslation(loaded.text) ? loaded : null
  // A clean copy from the better model is final. Anything else may be redone when the better model is here.
  if (saved && saved.model === BETTER_MODEL && !OTHER_SCRIPT.test(saved.text)) {
    return { ok: true, message: '저장해 둔 번역본이에요.', text: saved.text }
  }
  if (saved) {
    // Only look at what is installed; do not start the model server just to show a saved copy.
    const names = await installedModels()
    const betterHere = names ? hasModel(names, BETTER_MODEL) : false
    if (!OTHER_SCRIPT.test(saved.text) && !betterHere) return { ok: true, message: '저장해 둔 번역본이에요.', text: saved.text }
  }
  const stale = slot?.name ? savedTranslationStale(home, slot.placeId, slot.name, source) : false
  const model = await ensureModel()
  if (saved && model !== 'ready') {
    return { ok: true, message: '저장해 둔 번역본이에요. 번역 모델이 준비되면 더 자연스럽게 다시 번역해요.', text: saved.text }
  }
  if (model !== 'ready') {
    return { ok: false, message: MODEL_MESSAGES[model], text: source }
  }
  try {
    const split = splitFront(source)
    const head = split.head ? await translateFrontMatter(split.head) : ''
    const body = await translateBody(split.body)
    const restored = stripTranslationFence(`${head}${body}`)
    if (!restored.trim() || isBrokenTranslation(restored)) {
      return { ok: false, message: '번역이 자연스럽지 않아서 저장하지 않았어요. 한 번 더 눌러 주세요.', text: source }
    }
    const text = restored.endsWith('\n') ? restored : `${restored}\n`
    if (slot?.name) writeSavedTranslation(home, slot.placeId, slot.name, source, text, activeModel)
    const base = saved
      ? '더 좋은 모델로 번역본을 새로 만들어 저장했어요.'
      : stale
        ? '영어 글이 바뀌어서 번역본을 새로 저장했어요. 다음부터는 그 번역본을 보여요.'
        : '번역본을 저장했어요. 다음부터는 다시 번역하지 않아요.'
    return { ok: true, message: base + translationModelNote(), text }
  } catch {
    return { ok: false, message: '번역이 중간에 멈췄어요. 번역본을 한 번 더 눌러 주세요.', text: source }
  }
}

/** The name block at the top. Only the description sentence is translated. Keys stay as they are. */
export function splitFront(source: string): { head: string; body: string } {
  const text = source.replace(/\r\n/g, '\n')
  if (!text.startsWith('---\n')) return { head: '', body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { head: '', body: text }
  let close = end + 4
  if (text[close] === '\n') close += 1
  return { head: text.slice(0, close), body: text.slice(close) }
}

/** Only the description sentence in the top block gets Korean. The name and the block itself stay for agents. */
async function translateFrontMatter(block: string): Promise<string> {
  const lines = block.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(description:\s*)(["']?)(.*?)\2\s*$/)
    if (!match || !/[A-Za-z]/.test(match[3])) continue
    const korean = await translatePiece(match[3], 'summary')
    if (korean && summaryOk(korean)) lines[index] = `${match[1]}${JSON.stringify(korean)}`
  }
  return lines.join('\n')
}

/**
 * One Korean sentence for a skill card. Code and the rest of the file are not touched.
 * A sentence that repeats or is not Korean is refused, so a bad line is never saved.
 */
export async function translateSummary(english: string): Promise<Translation> {
  const source = english.replace(/\s+/g, ' ').trim().slice(0, 600)
  if (!source) return { ok: false, message: '번역할 설명이 없어요.', text: '' }
  if (proseHangulRatio(source) >= 0.45 && summaryOk(source)) return { ok: true, message: '이미 한글이에요.', text: source }
  const model = await ensureModel()
  if (model !== 'ready') return { ok: false, message: MODEL_MESSAGES[model], text: '' }
  try {
    const korean = await translatePiece(source, 'summary')
    if (!summaryOk(korean)) return { ok: false, message: '한 문장으로 자연스럽게 만들지 못했어요. 한 번 더 눌러 주세요.', text: '' }
    return { ok: true, message: '한글 설명을 만들었어요.', text: korean }
  } catch {
    return { ok: false, message: '번역이 중간에 멈췄어요. 한 번 더 눌러 주세요.', text: '' }
  }
}

/** Translate one paragraph at a time. A code fence is copied as it is. A bad paragraph stays in English. */
async function translateBody(body: string): Promise<string> {
  const done: string[] = []
  for (const block of proseBlocks(body)) {
    if (!block.trim() || block.trim().startsWith('```')) {
      done.push(block)
      continue
    }
    const visible = block.replace(/`[^`\n]+`/g, '')
    if (!/[A-Za-z]{3,}/.test(visible) || proseHangulRatio(block) >= 0.45) {
      done.push(block)
      continue
    }
    const masked = maskMarkdown(block)
    const korean = await translatePiece(masked.text, 'block')
    done.push(korean ? unmaskMarkdown(korean, masked.slots) : block)
  }
  return done.join('\n')
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
    const korean = await translatePiece(segment, 'line')
    segments.push(korean ? ` ${korean} ` : segment)
  }
  return `${piece.prefix}${segments.join('').replace(/\s{2,}/g, ' ').trim()}`
}

/**
 * One English sentence to one Korean sentence.
 * A first answer with Chinese characters or untranslated English is sent back once with the complaint;
 * an answer that is still not Korean falls back to the English so nothing wrong is saved.
 */
async function translatePiece(english: string, kind: 'summary' | 'block' | 'line'): Promise<string> {
  const source = english.trim()
  const first = await askKorean(source, kind)
  const firstProblem = judge(source, first)
  if (!firstProblem && (kind !== 'summary' || summaryOk(first))) return first
  const second = await askKorean(source, kind, first, `${firstProblem || '한 문장이 아니에요.'} 반복하지 말고 더 짧게 다시 써 주세요.`)
  if (!judge(source, second) && (kind !== 'summary' || summaryOk(second))) return second
  return acceptable(source, second) ? second : acceptable(source, first) ? first : ''
}

/** Why an answer is not yet good Korean, or an empty string when it is. */
export function judge(english: string, korean: string): string {
  if (!korean) return '답이 비어 있어요.'
  if (OTHER_SCRIPT.test(korean)) return '한자나 일본어 글자가 섞여 있어요.'
  if (isRepetitive(korean)) return '같은 말이 반복돼요.'
  if (!/[가-힣]/.test(korean)) return '한국어가 아니에요.'
  if (hangulShare(korean) < 0.45) return '한국어가 너무 적어요.'
  const leftovers = leftoverEnglish(english, korean)
  if (leftovers.length && (english.length < 80 || leftovers.length > 4)) return `영어 단어가 남아 있어요: ${leftovers.slice(0, 4).join(', ')}.`
  if (korean.length > Math.max(english.length * 2.2, english.length + 80)) return '원문보다 너무 길어요.'
  return ''
}

/** The bar for keeping a second answer that still has a flaw: mostly Hangul, no other scripts. */
function acceptable(english: string, korean: string): boolean {
  return Boolean(korean)
    && !isBrokenTranslation(korean)
    && hangulShare(korean) >= 0.6
    && korean.length <= Math.max(english.length * 2.2, english.length + 80)
    && leftoverEnglish(english, korean).length <= 4
}

async function askKorean(english: string, kind: 'summary' | 'block' | 'line', previous = '', complaint = ''): Promise<string> {
  const limit = kind === 'summary' ? '한 문장만, 120자 안으로 쓰세요.' : '줄바꿈과 목록 기호는 유지하고, 같은 말을 반복하지 마세요.'
  predictCap = kind === 'summary' ? 90 : Math.min(420, Math.max(80, Math.ceil(english.length * 0.9)))
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: 'Review pull requests and leave a short comment.' },
    { role: 'assistant', content: '풀 리퀘스트를 살펴보고 짧은 의견을 남겨요.' },
    { role: 'user', content: 'Run the tests before you merge.' },
    { role: 'assistant', content: '합치기 전에 테스트를 실행하세요.' },
    { role: 'user', content: `${limit}\n\n${english}` },
  ]
  if (complaint) messages.push({ role: 'assistant', content: previous || '(빈 답)' }, { role: 'user', content: complaint })
  const answer = await freeTranslate(messages)
  return answer.trim().replace(/^(Korean:|한국어:|번역:)\s*/i, '').replace(/^["“]|["”]$/g, '').replace(/\s*\n+\s*/g, ' ').trim()
}

/**
 * Translate one awkward line again and keep every other saved line.
 * The English skill file is not touched.
 */
export async function retranslateSkillLine(
  source: string,
  korean: string,
  target: 'description' | number,
  slot?: TranslationSlot,
): Promise<Translation> {
  const src = splitSkillText(source)
  const ko = splitSkillText(korean)
  const srcLines = src.body.split('\n')
  const koLines = ko.body.split('\n')
  if (target !== 'description' && srcLines.length !== koLines.length) {
    return { ok: false, message: '번역본 줄 수가 원문과 달라서, 이 줄만 다시 하기는 어려워요. 번역본을 한 번 더 눌러 주세요.', text: korean }
  }
  const english = target === 'description' ? src.description : srcLines[target] ?? ''
  if (!lineToTranslate(target === 'description' ? english : maskMarkdown(english).text)) {
    return { ok: false, message: '이 줄은 번역할 영어가 없어요.', text: korean }
  }
  const model = await ensureModel()
  if (model !== 'ready') return { ok: false, message: MODEL_MESSAGES[model], text: korean }
  try {
    const masked = maskMarkdown(english)
    const next = target === 'description'
      ? await translatePiece(english, 'summary')
      : unmaskMarkdown(await translateLine(masked.text), masked.slots)
    if (!next.trim() || !/[가-힣]/.test(next) || next.trim() === english.trim()) {
      return { ok: false, message: '이 줄은 다시 번역하지 못해서 그대로 뒀어요.', text: korean }
    }
    const patched = target === 'description' ? patchDescription(korean, next) : patchVisibleLine(korean, target, next)
    if (!patched) return { ok: false, message: '이 줄을 저장하지 못했어요. 번역본은 그대로예요.', text: korean }
    const home = slot?.home || os.homedir()
    if (slot?.name) writeSavedTranslation(home, slot.placeId, slot.name, source, patched, activeModel)
    return { ok: true, message: '이 줄만 다시 번역해서 저장했어요.', text: patched }
  } catch {
    return { ok: false, message: '이 줄 번역이 중간에 멈췄어요. 한 번 더 눌러 주세요.', text: korean }
  }
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
  pulling: '번역 모델을 처음 한 번 내려받고 있어요(약 5GB). 몇 분 뒤 번역본을 다시 눌러 주세요.',
}

/** One background start, so a second translation does not open another copy. */
let serveStart: Promise<void> | null = null
/** The model the next request uses. Set by ensureModel from what is installed. */
let activeModel = SMALL_MODEL
/** The better model is asked for once per run, so a slow download is not restarted on every click. */
let betterPullStarted = false

/** Which model is answering right now, for the message the Founder reads. */
export function translationModelNote(): string {
  return activeModel === BETTER_MODEL ? '' : ' 지금은 작은 모델이 번역해요. 더 좋은 모델을 받는 중이라, 받은 뒤에는 번역이 훨씬 자연스러워요.'
}

function hasModel(names: string[], model: string): boolean {
  return names.some((name) => name === model || name.startsWith(`${model}:`) || name === `${model}:latest`)
}

/**
 * Start the local model server when it is not answering, and fetch the free model the first time.
 * The server stays behind DIOS. It does not open a window or take the screen.
 */
async function ensureModel(): Promise<ModelState> {
  let names = await installedModels()
  if (!names) {
    const bin = ollamaBin()
    if (!bin) return 'no-ollama'
    if (!serveStart) {
      serveStart = Promise.resolve().then(() => startHidden(bin, ['serve']))
    }
    await serveStart
    for (let attempt = 0; attempt < 16 && !names; attempt += 1) {
      await wait(500)
      names = await installedModels()
    }
    if (!names) {
      serveStart = null
      return 'down'
    }
  }
  if (hasModel(names, BETTER_MODEL)) {
    activeModel = BETTER_MODEL
    return 'ready'
  }
  if (!betterPullStarted) {
    betterPullStarted = true
    startPull(BETTER_MODEL)
  }
  if (hasModel(names, SMALL_MODEL)) {
    activeModel = SMALL_MODEL
    return 'ready'
  }
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

/** Ask the server to download a model in the background. The answer is not awaited. */
function startPull(model: string): void {
  const body = JSON.stringify({ name: model, stream: false })
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

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** How many tokens the next answer may use. A short cap stops the model from repeating itself. */
let predictCap = 120

function freeTranslate(messages: ChatMessage[]): Promise<string> {
  const body = JSON.stringify({
    model: activeModel,
    messages,
    stream: false,
    options: { temperature: 0, num_predict: predictCap, repeat_penalty: 1.18, stop: ['\n\n\n'] },
  })
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { message?: { content?: string }; error?: string }
          const content = parsed.message?.content
          if (!content?.trim()) reject(new Error(parsed.error || 'empty'))
          else resolve(content)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(90000, () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
