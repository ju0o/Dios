import fs from 'fs'
import os from 'os'
import path from 'path'
import { distrosFromReg } from '../src/core/skill-board/places'
import { cmdArg, hiddenCommandLine, hiddenLaunchScript } from '../src/core/skill-board/quiet-process'
import { copyMessage, reviewBundle, reviewMessage, writeReviewBundle, writeSkillCopies } from '../src/core/skill-board/skill-export'

describe('quiet windows launch', () => {
  it('starts the translator hidden, without a new console', () => {
    const script = hiddenLaunchScript('C:\\Program Files\\Ollama\\ollama.exe', ['serve'])
    expect(script).toContain(', 0, False')
    expect(script).toContain('ollama.exe')
    expect(script).not.toContain('detached')
    expect(script).not.toContain('powershell')
  })

  it('quotes a path that has spaces', () => {
    expect(cmdArg('C:\\Program Files\\Ollama\\ollama.exe')).toBe('"C:\\Program Files\\Ollama\\ollama.exe"')
    const line = hiddenCommandLine('reg.exe', ['query', 'HKCU\\Software'], { cwd: 'C:\\Users\\me' })
    expect(line.startsWith('cd /d C:\\Users\\me && reg.exe query HKCU\\Software')).toBe(true)
  })
})

describe('wsl list without opening wsl', () => {
  it('reads distro names and skips docker', () => {
    const text = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{abc}',
      '    DistributionName    REG_SZ    Ubuntu',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{def}',
      '    DistributionName    REG_SZ    docker-desktop',
    ].join('\n')
    expect(distrosFromReg(text)).toEqual(['Ubuntu'])
  })
})

describe('desktop skill packs', () => {
  it('writes the picked skill onto a folder and says where in plain Korean', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-copy-'))
    const written = writeSkillCopies(dir, [{
      name: 'demo-skill',
      files: [{ path: 'SKILL.md', text: '---\nname: demo-skill\n---\n' }, { path: 'notes/extra.md', text: 'more' }],
    }])
    expect(written.count).toBe(1)
    expect(fs.readFileSync(path.join(dir, 'demo-skill', 'SKILL.md'), 'utf8')).toContain('demo-skill')
    expect(fs.readFileSync(path.join(dir, 'demo-skill', 'notes', 'extra.md'), 'utf8')).toBe('more')
    expect(copyMessage(1, 0)).toContain('DIOS-스킬')
    expect(copyMessage(1, 0)).not.toContain('C:\\')
  })

  it('makes one note per linked skill and a ChatGPT sheet, with no paid call', () => {
    const files = reviewBundle([
      { name: 'beta-skill', summary: '두 번째', korean: '', agentNames: ['Cursor'], text: 'beta body' },
      { name: 'alpha-skill', summary: '첫 번째', korean: '한글 설명', agentNames: ['Claude', 'Codex'], text: 'alpha body' },
    ])
    expect(files[0].fileName).toBe('00-ChatGPT에게-물어보기.md')
    expect(files[0].text).toContain('ChatGPT')
    expect(files[0].text).toContain('유료 AI를 부르지 않아요')
    expect(files[0].text).toContain('Claude, Codex')
    expect(files.map((file) => file.fileName)).toEqual([
      '00-ChatGPT에게-물어보기.md',
      '01-alpha-skill.md',
      '02-beta-skill.md',
    ])
    expect(files[1].text).toContain('붙은 에이전트: Claude, Codex')
    expect(files[1].text).toContain('한글 한 줄: 한글 설명')
    expect(files[1].text).toContain('alpha body')

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-review-'))
    fs.writeFileSync(path.join(dir, '09-old.md'), 'stale')
    writeReviewBundle(dir, [{ name: 'alpha-skill', summary: '', korean: '', agentNames: ['Claude'], text: 'alpha body' }])
    expect(fs.existsSync(path.join(dir, '09-old.md'))).toBe(false)
    expect(fs.existsSync(path.join(dir, '00-ChatGPT에게-물어보기.md'))).toBe(true)
    expect(reviewMessage(1, 0)).toContain('ChatGPT')
    expect(reviewMessage(0, 0)).toContain('붙은 스킬이 없어요')
  })
})
