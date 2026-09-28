import fs from 'fs'
import os from 'os'
import path from 'path'
import { attachAll, listTrash, trashSkill, untrashSkill } from '../src/core/skill-board/keeping'
import { listHistory, restoreVersion, saveSkillText } from '../src/core/skill-board/library'
import { linkSkill, loadBoard, textPrint } from '../src/core/skill-board/model'
import { koreanBlurbFromText, maskMarkdown, patchDescription, patchVisibleLine, proseHangulRatio, retryRows, splitSkillText, unmaskMarkdown } from '../src/core/skill-board/markdown-text'
import { readSavedTranslation, savedKoreanBlurb, writeSavedTranslation } from '../src/core/skill-board/translation-store'
import { lineToTranslate, splitAroundMasks, translateSkillMarkdown } from '../src/core/skill-board/translate'
import { compareMoves, matchesSearch, whenText } from '../src/renderer/pages/skill-board-api'

const TEXT = '---\nname: demo-skill\ndescription: 대표님이 직접 해야 할 일을 정리해요.\n---\n\n- 브라우저 일은 Aside에게 보내요.\n'

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-keep-'))
  const skill = path.join(home, '.agents', 'skills', 'demo-skill')
  fs.mkdirSync(skill, { recursive: true })
  fs.writeFileSync(path.join(skill, 'SKILL.md'), TEXT)
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
  return home
}

describe('skill history', () => {
  it('keeps the old text on save and restores it, keeping the replaced text too', () => {
    const home = makeHome()
    expect(listHistory(home, 'demo-skill').versions).toHaveLength(0)
    expect(saveSkillText(home, 'demo-skill', `${TEXT}- 새 줄이에요.\n`).ok).toBe(true)
    const history = listHistory(home, 'demo-skill')
    expect(history.versions).toHaveLength(1)
    expect(history.versions[0].diff).toBe(1)

    const restored = restoreVersion(home, 'demo-skill', history.versions[0].id)
    expect(restored.ok).toBe(true)
    expect(fs.readFileSync(path.join(home, '.agents', 'skills', 'demo-skill', 'SKILL.md'), 'utf8')).toBe(TEXT)
    expect(listHistory(home, 'demo-skill').versions).toHaveLength(2)
    expect(loadBoard(home).skills[0].changed).toBe(false)
  })

  it('keeps only the newest ten and refuses odd ids', () => {
    const home = makeHome()
    for (let i = 0; i < 13; i += 1) saveSkillText(home, 'demo-skill', `${TEXT}- ${i}번째 줄이에요.\n`)
    expect(listHistory(home, 'demo-skill').versions.length).toBe(10)
    expect(restoreVersion(home, 'demo-skill', '../x').ok).toBe(false)
  })
})

describe('skill trash', () => {
  it('takes the skill off every agent, then brings it back to the same agents', () => {
    const home = makeHome()
    linkSkill(home, 'claude', 'demo-skill')
    linkSkill(home, 'codex', 'demo-skill')
    const trashed = trashSkill(home, 'demo-skill')
    expect(trashed.ok).toBe(true)
    expect(trashed.board.skills.find((skill) => skill.name === 'demo-skill')).toBeUndefined()
    expect(fs.existsSync(path.join(home, '.claude', 'skills', 'demo-skill'))).toBe(false)

    const items = listTrash(home).items
    expect(items).toHaveLength(1)
    expect(items[0].agents.sort()).toEqual(['claude', 'codex'])

    const back = untrashSkill(home, items[0].id)
    expect(back.ok).toBe(true)
    expect(back.message).toContain('Claude, Codex에 붙였어요')
    expect(back.board.skills.find((skill) => skill.name === 'demo-skill')?.agents.sort()).toEqual(['claude', 'codex'])
    expect(listTrash(home).items).toHaveLength(0)
  })

  it('refuses when an agent holds a real copy, so no text is lost', () => {
    const home = makeHome()
    const copy = path.join(home, '.claude', 'skills', 'demo-skill')
    fs.mkdirSync(copy, { recursive: true })
    fs.writeFileSync(path.join(copy, 'SKILL.md'), TEXT)
    const trashed = trashSkill(home, 'demo-skill')
    expect(trashed.ok).toBe(false)
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
  })
})

describe('batch attach and helpers', () => {
  it('attaches ready agents in one pass and names the skipped ones', () => {
    const home = makeHome()
    const result = attachAll(home, 'demo-skill', ['claude', 'grok'])
    expect(result.message).toBe('Claude에 붙였어요. 빼 둔 곳: Grok.')
  })

  it('gives the same fingerprint for Windows and Linux line endings', () => {
    expect(textPrint('a\r\nb\r\n')).toBe(textPrint('a\nb'))
    expect(textPrint('')).toBe('')
  })

  it('writes relative times and filters by name or summary', () => {
    const now = Date.UTC(2026, 8, 27, 12)
    expect(whenText(now - 30_000, now)).toBe('방금')
    expect(whenText(now - 3 * 60_000, now)).toBe('3분 전')
    expect(whenText(now - 2 * 3_600_000, now)).toBe('2시간 전')
    expect(matchesSearch({ name: 'founder-ux', summary: '화면 문구 규칙' }, '문구')).toBe(true)
    expect(matchesSearch({ name: 'founder-ux', summary: '화면 문구 규칙' }, 'archify')).toBe(false)
  })

  it('keeps code and paths while the sentences around them change', () => {
    const source = '---\nname: demo\n---\n\nRun `npm test` then\n\n```\npath/file.md\n```\n\nHello team.\n'
    const masked = maskMarkdown(source)
    expect(masked.text).not.toContain('npm test')
    expect(masked.text).not.toContain('path/file.md')
    const restored = unmaskMarkdown(masked.text.replace('Hello team.', '안녕.'), masked.slots)
    expect(restored).toContain('`npm test`')
    expect(restored).toContain('path/file.md')
    expect(restored).toContain('안녕.')
    expect(proseHangulRatio('브라우저 일은 Aside에게 보내요.')).toBeGreaterThan(0.45)
    expect(proseHangulRatio('Send the file.')).toBe(0)
  })

  it('shows the saved Korean copy and does not keep a copy for a different English text', async () => {
    const home = makeHome()
    const source = 'Send the file to the team.\n'
    const korean = '파일을 팀에 보내요.\n'
    expect(readSavedTranslation(home, 'ssh:main', 'demo-skill', source)).toBeNull()
    expect(writeSavedTranslation(home, 'ssh:main', 'demo-skill', source, korean, 'qwen2.5:7b')).toBe(true)
    expect(readSavedTranslation(home, 'ssh:main', 'demo-skill', source)).toBe(korean)
    expect(readSavedTranslation(home, 'ssh:main', 'demo-skill', 'Send a different file.\n')).toBeNull()
    expect(writeSavedTranslation(home, 'ssh:main', '../demo-skill', source, korean)).toBe(false)

    const shown = await translateSkillMarkdown(source, { home, placeId: 'ssh:main', name: 'demo-skill' })
    expect(shown.ok).toBe(true)
    expect(shown.text).toBe(korean)
    expect(shown.message).toBe('저장해 둔 번역본이에요.')
    expect(lineToTranslate('## Send the file.')).toEqual({ prefix: '## ', body: 'Send the file.' })
    expect(lineToTranslate('- 브라우저 일은 Aside에게 보내요.')).toBeNull()
    expect(lineToTranslate('⟦0⟧')).toBeNull()
    expect(splitAroundMasks('Run ⟦0⟧ then open ⟦1⟧.')).toEqual(['Run ', '⟦0⟧', ' then open ', '⟦1⟧', '.'])
  })

  it('shows the saved Korean sentence in the list and replaces one awkward line', () => {
    const home = makeHome()
    const source = '---\nname: demo-skill\ndescription: Send the file to the team.\n---\n\n## Send the file.\nKeep the name.\n'
    const korean = '---\nname: demo-skill\ndescription: "파일을 팀에 보내요."\n---\n\n## 파일을 보내요.\n이름을 유지해요.\n'
    expect(writeSavedTranslation(home, 'local', 'demo-skill', source, korean)).toBe(true)
    expect(savedKoreanBlurb(home, 'local', 'demo-skill', textPrint(source))).toBe('파일을 팀에 보내요.')
    expect(savedKoreanBlurb(home, 'local', 'demo-skill', textPrint('other'))).toBe('')
    expect(koreanBlurbFromText('No description here.\n\n본문만 한글로 있어요.\n')).toBe('본문만 한글로 있어요.')
    expect(matchesSearch({ name: 'demo-skill', summary: 'Send the file.', koreanSummary: '파일을 팀에 보내요.' }, '팀에')).toBe(true)

    const rows = retryRows(source, korean)
    expect(rows.aligned).toBe(true)
    expect(rows.rows.map((row) => row.target)).toEqual(['description', 0, 1])
    const patched = patchVisibleLine(korean, 1, '## 이름을 그대로 둬요.')
    expect(splitSkillText(patched ?? '').body.split('\n')[1]).toBe('## 이름을 그대로 둬요.')
    const described = patchDescription(korean, '팀에 파일을 보내요.')
    expect(splitSkillText(described ?? '').description).toBe('팀에 파일을 보내요.')
    expect(retryRows(source, '한 줄만\n').aligned).toBe(false)
  })

  it('offers align, send, and bring from a compare row', () => {
    const cells = { local: 'base', asus: 'different', wsl: 'missing', aws: 'unknown' }
    expect(compareMoves('local', cells)).toEqual({ align: ['asus'], send: ['wsl'], bring: [] })
    expect(compareMoves('wsl', { wsl: 'missing', asus: 'different', local: 'unknown' })).toEqual({ align: [], send: [], bring: ['asus'] })
  })
})
