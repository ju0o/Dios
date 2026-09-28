import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorOf, extraSkillRoots, frontmatter, libraryMetaPath, readLibrary, readMeta, rememberAdded } from '../src/core/skill-library/catalog'
import { candidateFromFiles, fetchSkillCandidates, parseSkillSource } from '../src/core/skill-library/fetch-skill'
import { gatherLooseIn, gatherMessage, isGatherable } from '../src/core/skill-library/library-service'
import { welcomeCopy } from '../src/core/start/welcome'

let home: string

function skillText(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${name} 스킬 설명이에요.\n${extra}---\n\n# ${name}\n\n1. 첫 단계\n`
}

function putSkill(dir: string, name: string, extra = ''): string {
  const folder = path.join(dir, name)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'SKILL.md'), skillText(name, extra))
  return folder
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-library-'))
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

describe('readLibrary', () => {
  it('gathers the shared folder, agent folders, and tool folders into one card per name', () => {
    const canonical = putSkill(path.join(home, '.agents', 'skills'), 'alpha')
    fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true })
    fs.symlinkSync(canonical, path.join(home, '.claude', 'skills', 'alpha'), process.platform === 'win32' ? 'junction' : 'dir')
    putSkill(path.join(home, '.codex', 'skills'), 'alpha', 'author: someone\n')
    putSkill(path.join(home, '.cursor', 'skills-cursor'), 'builtin-thing')
    putSkill(path.join(home, '.hermes', 'skills', 'coding'), 'hermes-thing')

    const skills = readLibrary(home, [], new Date('2026-09-28T12:00:00Z'))
    const names = skills.map((skill) => skill.name)
    expect(names).toEqual(['alpha', 'builtin-thing', 'hermes-thing'])

    const alpha = skills.find((skill) => skill.name === 'alpha')!
    expect(alpha.canonical).toBe(true)
    expect(alpha.agents).toEqual(['claude', 'codex'])
    expect(alpha.homes.find((item) => item.id === 'claude')?.link).toBe(true)
    expect(alpha.homes.find((item) => item.id === 'codex')?.different).toBe(true)
    expect(alpha.summary).toContain('alpha 스킬 설명')

    const builtin = skills.find((skill) => skill.name === 'builtin-thing')!
    expect(builtin.canonical).toBe(false)
    expect(builtin.author).toBe('Cursor 기본 제공')
    expect(skills.find((skill) => skill.name === 'hermes-thing')?.author).toBe('Hermes')
  })

  it('on the first run judges age by the file date, afterwards by when the library first saw it', () => {
    const day = 86_400_000
    putSkill(path.join(home, '.agents', 'skills'), 'old-one')
    // A skill made just now is new when the library first runs today...
    expect(readLibrary(home, [], new Date())[0].isNew).toBe(true)
    fs.rmSync(libraryMetaPath(home))
    // ...but not when the library first runs ten days later.
    const first = readLibrary(home, [], new Date(Date.now() + 10 * day))
    expect(first[0].isNew).toBe(false)

    putSkill(path.join(home, '.agents', 'skills'), 'fresh-one')
    const second = readLibrary(home, [], new Date(Date.now() + 10 * day + 3_600_000))
    expect(second.find((skill) => skill.name === 'fresh-one')?.isNew).toBe(true)
    expect(second.find((skill) => skill.name === 'old-one')?.isNew).toBe(false)

    const later = readLibrary(home, [], new Date(Date.now() + 40 * day))
    expect(later.find((skill) => skill.name === 'fresh-one')?.isNew).toBe(false)
  })

  it('remembers who added a skill and forgets skills that vanished', () => {
    putSkill(path.join(home, '.agents', 'skills'), 'taken')
    readLibrary(home, [], new Date('2026-09-28T12:00:00Z'))
    rememberAdded(home, 'taken', '대표님이 추가', 'https://github.com/a/b', new Date('2026-09-28T12:01:00Z'))
    const skills = readLibrary(home, [], new Date('2026-09-28T12:02:00Z'))
    expect(skills[0].author).toBe('대표님이 추가')
    expect(skills[0].source).toBe('https://github.com/a/b')

    fs.rmSync(path.join(home, '.agents', 'skills', 'taken'), { recursive: true })
    readLibrary(home, [], new Date('2026-09-28T12:03:00Z'))
    expect(readMeta(libraryMetaPath(home)).skills.taken).toBeUndefined()
  })

  it('reads connected folders two levels deep and skips unsafe names', () => {
    const root = path.join(home, 'extra')
    putSkill(path.join(root, 'group'), 'deep-skill')
    putSkill(root, 'Bad Name')
    const skills = readLibrary(home, [root], new Date())
    expect(skills.map((skill) => skill.name)).toEqual(['deep-skill'])
    expect(skills[0].homes[0].id).toBe('folder')
  })

  it('finds the Windows Hermes folder from LOCALAPPDATA', () => {
    const local = path.join(home, 'AppData', 'Local')
    fs.mkdirSync(path.join(local, 'hermes', 'skills'), { recursive: true })
    const roots = extraSkillRoots(home, 'win32', { LOCALAPPDATA: local })
    expect(roots.some((root) => root.id === 'hermes' && root.path === path.join(local, 'hermes', 'skills'))).toBe(true)
    expect(extraSkillRoots(home, 'linux', {})).toEqual([])
    // Another user's LOCALAPPDATA never leaks into this home.
    const elsewhere = extraSkillRoots(home, 'win32', { LOCALAPPDATA: path.join(os.tmpdir(), 'someone-else', 'AppData', 'Local') })
    expect(elsewhere.every((root) => root.path.startsWith(home))).toBe(true)
  })
})

describe('frontmatter and authorOf', () => {
  it('reads name, description, and author-like keys', () => {
    const front = frontmatter('---\nname: my-skill\ndescription: "Does things"\nmetadata:\n  author: tt-a1i\n---\nbody')
    expect(front).toEqual({ name: 'my-skill', description: 'Does things', author: 'tt-a1i' })
    expect(frontmatter('no front').author).toBe('')
  })

  it('prefers what DIOS remembers, then the file, then the single folder it lives in', () => {
    const front = { name: 'x', description: '', author: 'file-author' }
    expect(authorOf(front, { firstSeen: 1, addedBy: '대표님이 추가' }, [], true)).toBe('대표님이 추가')
    expect(authorOf(front, { firstSeen: 1 }, [], true)).toBe('file-author')
    const blank = { name: 'x', description: '', author: '' }
    expect(authorOf(blank, { firstSeen: 1 }, [{ id: 'codex', name: 'Codex', path: '', link: false, different: false }], false)).toBe('Codex 폴더에서 나왔어요')
    expect(authorOf(blank, { firstSeen: 1 }, [], true)).toBe('')
  })
})

describe('parseSkillSource', () => {
  it('understands GitHub pages, raw files, and the short owner/repo form', () => {
    expect(parseSkillSource('https://github.com/acme/skills/tree/main/skills/deploy')).toMatchObject({ kind: 'github', owner: 'acme', repo: 'skills', ref: 'main', dir: 'skills/deploy' })
    expect(parseSkillSource('https://github.com/acme/skills/blob/main/skills/deploy/SKILL.md')).toMatchObject({ dir: 'skills/deploy', ref: 'main' })
    expect(parseSkillSource('github.com/acme/skills')).toMatchObject({ kind: 'github', owner: 'acme', repo: 'skills', dir: '' })
    expect(parseSkillSource('https://raw.githubusercontent.com/acme/skills/main/skills/deploy/SKILL.md')).toMatchObject({ kind: 'github', dir: 'skills/deploy', ref: 'main' })
    expect(parseSkillSource('acme/skills.git')).toMatchObject({ repo: 'skills', dir: '' })
    expect(parseSkillSource('acme/skills/deploy')).toMatchObject({ dir: 'skills/deploy' })
    expect(parseSkillSource('https://example.com/x/SKILL.md')).toMatchObject({ kind: 'raw' })
    expect(parseSkillSource('hello there')).toBeNull()
    expect(parseSkillSource('https://example.com/page')).toBeNull()
  })
})

describe('fetchSkillCandidates', () => {
  type Route = Record<string, unknown>

  function fetcherOf(routes: Route, status = 200) {
    return async (url: string) => {
      const key = url.split('?')[0]
      const hit = Object.prototype.hasOwnProperty.call(routes, key)
      if (!hit) return { ok: false, status: 404, text: async () => '', json: async () => ({}) }
      const body = routes[key]
      return { ok: status < 400, status, text: async () => String(body), json: async () => body }
    }
  }

  const api = 'https://api.github.com/repos/acme/skills/contents'

  it('returns one candidate when the folder itself holds SKILL.md', async () => {
    const routes: Route = {
      [`${api}/skills/deploy`]: [
        { name: 'SKILL.md', path: 'skills/deploy/SKILL.md', type: 'file', size: 100, download_url: 'https://raw/deploy/SKILL.md' },
        { name: 'notes.md', path: 'skills/deploy/notes.md', type: 'file', size: 10, download_url: 'https://raw/deploy/notes.md' },
        { name: 'logo.png', path: 'skills/deploy/logo.png', type: 'file', size: 10, download_url: 'https://raw/deploy/logo.png' },
      ],
      'https://raw/deploy/SKILL.md': skillText('deploy'),
      'https://raw/deploy/notes.md': 'notes',
    }
    const out = await fetchSkillCandidates('https://github.com/acme/skills/tree/main/skills/deploy', fetcherOf(routes))
    expect(out.ok).toBe(true)
    expect(out.candidates).toHaveLength(1)
    expect(out.candidates[0].name).toBe('deploy')
    expect(out.candidates[0].files.map((file) => file.path)).toEqual(['SKILL.md', 'notes.md'])
  })

  it('lists every skill in a repository skills folder so the Founder can pick', async () => {
    const routes: Route = {
      [api + '/']: [{ name: 'skills', path: 'skills', type: 'dir' }, { name: 'README.md', path: 'README.md', type: 'file' }],
      [`${api}/skills`]: [{ name: 'one', path: 'skills/one', type: 'dir' }, { name: 'two', path: 'skills/two', type: 'dir' }],
      [`${api}/skills/one`]: [{ name: 'SKILL.md', path: 'skills/one/SKILL.md', type: 'file', size: 1, download_url: 'https://raw/one' }],
      [`${api}/skills/two`]: [{ name: 'SKILL.md', path: 'skills/two/SKILL.md', type: 'file', size: 1, download_url: 'https://raw/two' }],
      'https://raw/one': skillText('one'),
      'https://raw/two': skillText('two'),
    }
    const out = await fetchSkillCandidates('acme/skills', fetcherOf(routes))
    expect(out.ok).toBe(true)
    expect(out.candidates.map((candidate) => candidate.name)).toEqual(['one', 'two'])
    expect(out.message).toContain('2개')
  })

  it('explains a missing address and a rate limit in plain words', async () => {
    const missing = await fetchSkillCandidates('acme/nothing', fetcherOf({}))
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('못 찾았어요')

    const limited = await fetchSkillCandidates('acme/skills', fetcherOf({ [api + '/']: { message: 'rate' } }, 403))
    expect(limited.ok).toBe(false)
    expect(limited.message).toContain('잠시')

    const nonsense = await fetchSkillCandidates('???', fetcherOf({}))
    expect(nonsense.message).toContain('붙여 넣어')
  })

  it('takes a plain SKILL.md address and names the skill from its folder', async () => {
    const out = await fetchSkillCandidates('https://example.com/stuff/writer/SKILL.md', fetcherOf({ 'https://example.com/stuff/writer/SKILL.md': '---\ndescription: 글쓰기\n---\n# writer\n' }))
    expect(out.ok).toBe(true)
    expect(out.candidates[0].name).toBe('writer')
  })
})

describe('gatherLooseIn', () => {
  it('copies a skill that lives in one folder and leaves Cursor built-ins alone', () => {
    putSkill(path.join(home, '.hermes', 'skills'), 'from-hermes')
    putSkill(path.join(home, '.cursor', 'skills-cursor'), 'cursor-own')
    putSkill(path.join(home, '.codex', 'skills'), 'only-codex')
    fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true })

    const outcome = gatherLooseIn(home)
    expect(outcome.done).toBe(2)
    expect(outcome.message).toContain('2개')
    expect(outcome.message).toContain('Cursor가 기본으로')
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'from-hermes', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'only-codex', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'cursor-own', 'SKILL.md'))).toBe(false)
    expect(fs.existsSync(path.join(home, '.hermes', 'skills', 'from-hermes', 'SKILL.md'))).toBe(true)

    const again = gatherLooseIn(home)
    expect(again.done).toBe(0)
    expect(again.message).toContain('모을 수 있는 스킬이 없어요')
  })

  it('describes an empty gather and a skipped built-in', () => {
    expect(gatherMessage(0, 0, 0)).toContain('없어요')
    expect(gatherMessage(3, 2, 1)).toContain('3개')
    expect(gatherMessage(3, 2, 1)).toContain('2개')
    expect(isGatherable({ name: 'x', summary: '', korean: '', print: '', canonical: false, homes: [{ id: 'hermes', name: 'Hermes', path: '/a', link: false, different: false }], agents: [], author: '', source: '', createdAt: 0, updatedAt: 0, isNew: false, fileCount: 1 })).toBe(true)
    expect(isGatherable({ name: 'x', summary: '', korean: '', print: '', canonical: false, homes: [{ id: 'cursor-builtin', name: 'Cursor', path: '/a', link: false, different: false }], agents: [], author: '', source: '', createdAt: 0, updatedAt: 0, isNew: false, fileCount: 1 })).toBe(false)
  })
})

describe('welcomeCopy', () => {
  it('says what was found, and what to do when nothing was found', () => {
    const found = welcomeCopy({ agents: ['Claude', 'Codex'], skillCount: 12, looseCount: 4, newCount: 1 })
    expect(found.headline).toContain('Claude, Codex를 찾았어요')
    expect(found.headline).toContain('12개')
    expect(found.next).toContain('4개')
    expect(found.next).toContain('새로 생겼어요')
    const empty = welcomeCopy({ agents: [], skillCount: 0, looseCount: 0, newCount: 0 })
    expect(empty.headline).toContain('못 찾았어요')
    expect(empty.next).toContain('라이브러리')
  })
})

describe('candidateFromFiles', () => {
  it('refuses names that agents cannot load', () => {
    expect(candidateFromFiles('Bad Name', [{ path: 'SKILL.md', text: '# x' }], '')).toBeNull()
    expect(candidateFromFiles('fallback', [{ path: 'SKILL.md', text: '---\nname: Nice-Name\n---\n' }], '')?.name).toBe('nice-name')
  })
})
