import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { isFreshUpdate, releaseNoteLines, whatsNewCopy } from '../src/core/update/whats-new'

describe('what changed after an update', () => {
  it('reads plain lines from release notes and drops headings and bullets', () => {
    const raw = '# 0.2.2\n\n- 첫 번째 바뀐 것이에요.\n* 두 번째예요.\n\nv0.2.1\n세 번째예요.\n'
    expect(releaseNoteLines(raw)).toEqual(['첫 번째 바뀐 것이에요.', '두 번째예요.', '세 번째예요.'])
  })

  it('shows the line only after a real version change', () => {
    expect(isFreshUpdate('', '0.2.2')).toBe(false)
    expect(isFreshUpdate('0.2.2', '0.2.2')).toBe(false)
    expect(isFreshUpdate('0.2.1', '0.2.2')).toBe(true)
  })

  it('puts the first change in the headline and folds the rest', () => {
    const copy = whatsNewCopy({ version: '0.2.2', lines: ['그래프가 생겼어요.', '스킬을 골라 붙여요.'] })
    expect(copy.headline).toBe('0.2.2로 새로워졌어요 · 그래프가 생겼어요.')
    expect(copy.more).toEqual(['스킬을 골라 붙여요.'])
    expect(whatsNewCopy({ version: '0.3.0', lines: [] }).headline).toBe('0.3.0로 새로워졌어요.')
  })

  it('keeps the shipped release notes in plain Korean', () => {
    const lines = releaseNoteLines(fs.readFileSync(path.join(__dirname, '..', 'release-notes.md'), 'utf8'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/[가-힣]/)
  })
})
