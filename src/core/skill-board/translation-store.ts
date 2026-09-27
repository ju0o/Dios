import fs from 'fs'
import path from 'path'
import { textPrint } from './model'

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/
const MAX_TEXT = 256_000

interface SavedTranslation {
  print: string
  text: string
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

/** Keep a successful Korean copy. The English skill file is not touched. */
export function writeSavedTranslation(home: string, placeId: string, name: string, source: string, korean: string): boolean {
  const file = slotPath(home, placeId, name)
  const print = textPrint(source)
  if (!file || !print || !korean.trim() || korean.length > MAX_TEXT) return false
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.dios-tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ print, text: korean.endsWith('\n') ? korean : `${korean}\n` })}\n`)
  fs.renameSync(tmp, file)
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
