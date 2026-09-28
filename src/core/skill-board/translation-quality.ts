const OTHER_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/

/** The model repeated itself. Short sentences are left alone. */
export function isRepetitive(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (compact.length < 48) return false
  const size = Math.min(24, Math.floor(compact.length / 3))
  if (size < 12) return false
  const slice = compact.slice(0, size)
  let count = 0
  let from = 0
  while (from < compact.length) {
    const at = compact.indexOf(slice, from)
    if (at < 0) break
    count += 1
    if (count >= 3) return true
    from = at + 1
  }
  return false
}

/**
 * A saved translation that should be thrown away: Chinese or Japanese letters,
 * the same phrase copied over and over, or one runaway line.
 */
export function isBrokenTranslation(text: string): boolean {
  if (!text.trim()) return true
  if (OTHER_SCRIPT.test(text)) return true
  if (isRepetitive(text)) return true
  return text.split('\n').some((line) => line.length > 500)
}

/** A one-line card sentence is usable when it is short Korean and does not repeat. */
export function summaryOk(korean: string): boolean {
  const text = korean.replace(/\s+/g, ' ').trim()
  if (text.length < 4 || text.length > 180) return false
  if (isBrokenTranslation(text)) return false
  const letters = [...text].filter((char) => /[\p{L}]/u.test(char))
  if (!letters.length) return false
  const hangul = letters.filter((char) => /[가-힣]/.test(char)).length / letters.length
  return hangul >= 0.5
}

/**
 * Blank lines split the prose. A code fence stays one block so it is never translated.
 */
export function proseBlocks(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let fence = false
  const flush = () => {
    if (!current.length) return
    blocks.push(current.join('\n'))
    current = []
  }
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (!fence) {
        flush()
        fence = true
        current.push(line)
      } else {
        current.push(line)
        fence = false
        flush()
      }
      continue
    }
    if (!fence && !line.trim()) {
      flush()
      blocks.push('')
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}
