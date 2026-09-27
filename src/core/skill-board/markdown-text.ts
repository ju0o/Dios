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

/** Drop a single fence a translator sometimes wraps around the whole answer. */
export function stripTranslationFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
  return fence ? fence[1] : trimmed
}
