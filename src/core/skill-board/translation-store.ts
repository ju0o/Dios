import fs from 'fs'
import path from 'path'
import { koreanBlurbFromText } from './markdown-text'
import { isBrokenTranslation, summaryOk } from './translation-quality'
import { textPrint } from './model'

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/
const MAX_TEXT = 256_000

interface SavedTranslation {
  print: string
  text: string
  /** Which local model wrote it. Missing on copies made before this field existed. */
  model?: string
}

/** The saved copy for this exact English text with the model that made it, or null. */
export function readSavedTranslationMeta(home: string, placeId: string, name: string, source: string): { text: string; model: string } | null {
  const file = slotPath(home, placeId, name)
  if (!file || !fs.existsSync(file)) return null
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedTranslation
    if (!saved.text?.trim() || saved.print !== textPrint(source)) return null
    return { text: saved.text, model: saved.model ?? '' }
  } catch {
    return null
  }
}

/** File name for one skill on one computer. Odd names are refused so nothing is written outside the folder. */
function slotName(placeId: string, name: string): string | null {
  if (!SAFE_NAME.test(name)) return null
  const place = placeId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  if (!place) return null
  return `${place}--${name}`
}

function slotPath(home: string, placeId: string, name: string): string | null {
  const slot = slotName(placeId, name)
  if (!slot) return null
  return path.join(home, '.local', 'share', 'dios', 'skill-translations', `${slot}.json`)
}

/**
 * Korean copy saved for this exact English skill text.
 * A different English text returns null so the screen translates once more.
 */
export function readSavedTranslation(home: string, placeId: string, name: string, source: string): string | null {
  const file = slotPath(home, placeId, name)
  if (!file || !fs.existsSync(file)) return null
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedTranslation
    if (!saved.text?.trim() || saved.print !== textPrint(source)) return null
    return saved.text
  } catch {
    return null
  }
}

/** The saved copy with its fingerprint, for sending to another computer. Null when none is saved. */
export function readSavedTranslationRaw(home: string, placeId: string, name: string): { print: string; text: string } | null {
  const file = slotPath(home, placeId, name)
  if (!file || !fs.existsSync(file)) return null
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedTranslation
    if (!saved.text?.trim() || !saved.print) return null
    return { print: saved.print, text: saved.text }
  } catch {
    return null
  }
}

/** Keep a Korean copy that arrived with its fingerprint already known. */
export function writeSavedTranslationRaw(home: string, placeId: string, name: string, print: string, korean: string): boolean {
  const file = slotPath(home, placeId, name)
  if (!file || !print || !korean.trim() || korean.length > MAX_TEXT) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.dios-tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ print, text: korean.endsWith('\n') ? korean : `${korean}\n` })}\n`)
  fs.renameSync(tmp, file)
  return true
}

/** Keep a successful Korean copy. The English skill file is not touched. */
export function writeSavedTranslation(home: string, placeId: string, name: string, source: string, korean: string, model = ''): boolean {
  const file = slotPath(home, placeId, name)
  const print = textPrint(source)
  if (!file || !print || !korean.trim() || korean.length > MAX_TEXT) return false
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.dios-tmp`
  const saved: SavedTranslation = { print, text: korean.endsWith('\n') ? korean : `${korean}\n` }
  if (model) saved.model = model
  fs.writeFileSync(tmp, `${JSON.stringify(saved)}\n`)
  fs.renameSync(tmp, file)
  return true
}

/** Short Korean sentence for the skill list, only when it still matches this English text. */
export function savedKoreanBlurb(home: string, placeId: string, name: string, print: string): string {
  const file = slotPath(home, placeId, name)
  if (!file || !print || !fs.existsSync(file)) return ''
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedTranslation
    if (!saved.text?.trim() || saved.print !== print || isBrokenTranslation(saved.text)) return ''
    const blurb = koreanBlurbFromText(saved.text)
    return summaryOk(blurb) ? blurb : ''
  } catch {
    return ''
  }
}

interface BlurbFile {
  version: 1
  skills: Record<string, { print: string; text: string }>
}

function blurbFile(home: string): string {
  return path.join(home, '.local', 'share', 'dios', 'skill-blurbs.json')
}

/** The one Korean sentence for a skill card, when it still matches this skill text. */
export function readBlurb(home: string, name: string, print: string): string {
  if (!print) return ''
  try {
    const parsed = JSON.parse(fs.readFileSync(blurbFile(home), 'utf8')) as BlurbFile
    const entry = parsed.skills?.[name]
    if (!entry || entry.print !== print || !summaryOk(entry.text)) return ''
    return entry.text
  } catch {
    return ''
  }
}

/** Remember one Korean sentence. A broken sentence is not stored. */
export function writeBlurb(home: string, name: string, print: string, korean: string): boolean {
  const text = korean.replace(/\s+/g, ' ').trim()
  if (!print || !summaryOk(text)) return false
  const file = blurbFile(home)
  let parsed: BlurbFile = { version: 1, skills: {} }
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf8')) as BlurbFile
    if (current?.version === 1 && current.skills) parsed = current
  } catch {
    // The first sentence starts a new file.
  }
  parsed.skills[name] = { print, text }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(parsed))
  return true
}

/** True when a saved copy exists but it was made from an older English text. */
export function savedTranslationStale(home: string, placeId: string, name: string, source: string): boolean {
  const file = slotPath(home, placeId, name)
  if (!file || !fs.existsSync(file)) return false
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedTranslation
    return Boolean(saved.print) && saved.print !== textPrint(source)
  } catch {
    return false
  }
}
