/** What the app says once after it has been updated. */
export interface WhatsNew {
  version: string
  /** Plain Korean lines from release-notes.md, one change each. */
  lines: string[]
}

/** Lines of release-notes.md, dropping headings, bullets, and blank lines. */
export function releaseNoteLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').replace(/^#+\s*/, '').trim())
    .filter((line) => line && !/^v?\d+\.\d+/.test(line))
    .slice(0, 6)
}

/** True when this launch is the first one on a newer version than the Founder last saw. */
export function isFreshUpdate(seenVersion: string, current: string): boolean {
  if (!current) return false
  if (!seenVersion) return false
  return seenVersion !== current
}

/** "0.2.2로 새로워졌어요 · 첫 줄" plus the rest for a fold. */
export function whatsNewCopy(news: WhatsNew): { headline: string; more: string[] } {
  const [first = '', ...rest] = news.lines
  const headline = first ? `${news.version}로 새로워졌어요 · ${first}` : `${news.version}로 새로워졌어요.`
  return { headline, more: rest }
}
