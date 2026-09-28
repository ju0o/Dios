const FENCE = /```[\s\S]*?```/g
const INLINE = /`[^`\n]+`/g

/**
 * Hide code fences and inline code before a translator sees the file.
 * The marks go back to the original text afterward, so commands and paths stay put.
 */
export function maskMarkdown(source: string): { text: string; slots: string[] } {
  const slots: string[] = []
  const keep = (token: string): string => {
    const mark = `⟦${slots.length}⟧`
    slots.push(token)
    return mark
  }
  return { text: source.replace(FENCE, keep).replace(INLINE, keep), slots }
}

/** Put the hidden code back. Unknown marks are left as they are. */
export function unmaskMarkdown(text: string, slots: string[]): string {
  return text.replace(/⟦(\d+)⟧/g, (mark, index: string) => slots[Number(index)] ?? mark)
}

/** How much of the prose (not the code) is Hangul. */
export function proseHangulRatio(source: string): number {
  const visible = maskMarkdown(source).text.replace(/⟦\d+⟧/g, '').replace(/\s/g, '')
  const chars = [...visible]
  if (!chars.length) return 0
  return chars.filter((char) => /[가-힣]/.test(char)).length / chars.length
}

/**
 * Split a SKILL.md into its one-line description and the body a person reads.
 * The name/description block at the top is for agents, so the reader shows it as a plain sentence instead.
 */
export function splitSkillText(source: string): { description: string; body: string } {
  const match = source.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { description: '', body: source }
  const line = match[1].split('\n').find((row) => row.startsWith('description:')) ?? ''
  const description = line.replace(/^description:\s*/, '').replace(/^["']|["']$/g, '').trim()
  return { description, body: match[2].replace(/^\s+/, '') }
}

const LINE_PREFIX = /^(\s*(?:#{1,6} |[-*+] |\d+\. |> )?)/

/**
 * The words of one line that still need Korean.
 * A heading or list mark stays outside the result. Korean lines and code-only lines return null.
 */
export function lineToTranslate(line: string): { prefix: string; body: string } | null {
  const prefix = line.match(LINE_PREFIX)?.[1] ?? ''
  const body = line.slice(prefix.length).trim()
  if (!/[A-Za-z]/.test(body.replace(/⟦\d+⟧/g, ''))) return null
  if (proseHangulRatio(body) >= 0.45) return null
  return { prefix, body }
}

/** One sentence for the skill list, taken from a saved Korean copy. */
export function koreanBlurbFromText(text: string): string {
  const split = splitSkillText(text)
  const pick = (line: string): string => {
    const clean = line.replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s*/, '').replace(/^\d+\.\s*/, '').trim()
    if (!/[가-힣]/.test(clean)) return ''
    return clean.length > 90 ? `${clean.slice(0, 90).trim()}…` : clean
  }
  return pick(split.description) || split.body.split('\n').map(pick).find(Boolean) || ''
}

export interface RetryRow {
  /** 'description' or the body line index the reader sees. */
  target: 'description' | number
  text: string
}

/** Lines the Founder can send back to the translator without redoing the whole file. */
export function retryRows(source: string, korean: string): { rows: RetryRow[]; aligned: boolean } {
  const src = splitSkillText(source)
  const ko = splitSkillText(korean)
  const rows: RetryRow[] = []
  if (lineToTranslate(src.description)) rows.push({ target: 'description', text: ko.description || src.description })
  const srcLines = src.body.split('\n')
  const koLines = ko.body.split('\n')
  const aligned = srcLines.length === koLines.length
  if (!aligned) return { rows, aligned }
  srcLines.forEach((line, index) => {
    if (!lineToTranslate(maskMarkdown(line).text)) return
    const text = (koLines[index] ?? '').trim()
    if (!text) return
    rows.push({ target: index, text })
  })
  return { rows, aligned }
}

/** Replace the description sentence inside the top block. The rest of the file stays. */
export function patchDescription(korean: string, next: string): string | null {
  const normalized = korean.replace(/\r\n/g, '\n')
  const match = normalized.match(/^(---\n)([\s\S]*?)(\n---\n?)([\s\S]*)$/)
  if (!match) return null
  const lines = match[2].split('\n')
  const index = lines.findIndex((line) => line.startsWith('description:'))
  if (index < 0) return null
  lines[index] = `description: ${JSON.stringify(next)}`
  const text = `${match[1]}${lines.join('\n')}${match[3]}${match[4]}`
  return text.endsWith('\n') ? text : `${text}\n`
}

/** Replace one body line the reader sees. Leading blank lines in the file are kept. */
export function patchVisibleLine(korean: string, index: number, next: string): string | null {
  const normalized = korean.replace(/\r\n/g, '\n')
  const match = normalized.match(/^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/)
  const head = match ? match[1] : ''
  const body = match ? match[2] : normalized
  const stripped = body.replace(/^\s+/, '')
  const removed = body.slice(0, body.length - stripped.length)
  const offset = removed ? removed.split('\n').length - 1 : 0
  const lines = body.split('\n')
  const at = offset + index
  if (index < 0 || at < 0 || at >= lines.length) return null
  lines[at] = next
  const text = head + lines.join('\n')
  return text.endsWith('\n') ? text : `${text}\n`
}

/** Drop a single fence a translator sometimes wraps around the whole answer. */
export function stripTranslationFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
  return fence ? fence[1] : trimmed
}
