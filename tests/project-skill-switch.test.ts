import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProjectSkills, relayProjects, saveProjectSkillPack, setProjectSkill } from '../src/core/skill-board/project-skill-switch'

const homes: string[] = []

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-project-skill-'))
  homes.push(home)
  const file = path.join(home, '.local', 'share', 'AgentRelay', 'night-runtime', 'config', 'portfolio.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({
    title: '그대로',
    projects: [
      { id: 'juplan', title: '기획', skills: { pm: ['founder-ux'], worker: ['founder-ux'], note: '남김' } },
      { id: 'dios', skills: { pm: ['demo-skill'] } },
    ],
  }))
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})

describe('project skill switch', () => {
  it('lists the matching project and turns a skill off, then back on', () => {
    const home = makeHome()
    const listed = listProjectSkills(home, 'JuPlan')
    expect(listed.matched).toBe(true)
    expect(listed.label).toBe('JuPlan')
    expect(listed.skills.map((skill) => skill.name)).toEqual(['founder-ux'])
    expect(listed.skills[0].on).toBe(true)

    const off = setProjectSkill(home, 'JuPlan', 'founder-ux', false)
    expect(off.message).toBe('JuPlan에서 뺐어요. 스킬 글은 그대로예요.')
    expect(off.skills).toEqual([{ name: 'founder-ux', lanes: [], on: false, korean: '' }])

    const saved = JSON.parse(fs.readFileSync(path.join(home, '.local', 'share', 'AgentRelay', 'night-runtime', 'config', 'portfolio.json'), 'utf8'))
    expect(saved.title).toBe('그대로')
    expect(saved.projects[0].title).toBe('기획')
    expect(saved.projects[0].skills.note).toBe('남김')
    expect(saved.projects[0].skills.pm).toEqual([])
    expect(saved.projects[1].skills.pm).toEqual(['demo-skill'])

    const on = setProjectSkill(home, 'JuPlan', 'founder-ux', true)
    expect(on.message).toBe('JuPlan에 붙였어요.')
    expect(on.skills[0].on).toBe(true)
    expect(on.skills[0].lanes).toEqual(['계획', '만들기', '검사'])
  })

  it('offers shared-folder skills the project does not use yet', () => {
    const home = makeHome()
    for (const name of ['founder-ux', 'spare-skill']) {
      const folder = path.join(home, '.agents', 'skills', name)
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} 설명이에요.\n---\n# ${name}\n`)
    }
    const listed = listProjectSkills(home, 'JuPlan')
    expect(listed.available.map((skill) => skill.name)).toEqual(['spare-skill'])
    const added = setProjectSkill(home, 'JuPlan', 'spare-skill', true)
    expect(added.message).toBe('JuPlan에 붙였어요.')
    expect(added.skills.map((skill) => skill.name)).toEqual(['founder-ux', 'spare-skill'])
    expect(added.available).toEqual([])
  })

  it('lists every Agent Relay project with its skills, even one with none', () => {
    const home = makeHome()
    const file = path.join(home, '.local', 'share', 'AgentRelay', 'night-runtime', 'config', 'portfolio.json')
    const portfolio = JSON.parse(fs.readFileSync(file, 'utf8'))
    portfolio.projects.push({ id: 'juceipt' }, { id: 'bad name' })
    fs.writeFileSync(file, JSON.stringify(portfolio))
    expect(relayProjects(home)).toEqual([
      { id: 'dios', label: 'Dios', skills: ['demo-skill'] },
      { id: 'juceipt', label: 'JuCeipt', skills: [] },
      { id: 'juplan', label: 'JuPlan', skills: ['founder-ux'] },
    ])
    expect(relayProjects(fs.mkdtempSync(path.join(os.tmpdir(), 'dios-empty-')))).toEqual([])
  })

  it('writes the skills that are on into one desktop folder per project, with a sheet for Aside', () => {
    const home = makeHome()
    const desktop = path.join(home, 'Desktop')
    fs.mkdirSync(desktop, { recursive: true })
    const folder = path.join(home, '.agents', 'skills', 'founder-ux')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: founder-ux\ndescription: 화면 규칙이에요.\n---\n# founder-ux\n본문\n')

    const saved = saveProjectSkillPack(home, 'JuPlan', desktop)
    expect(saved.ok).toBe(true)
    expect(saved.message).toBe('바탕화면에 JuPlan의 스킬 글 1개를 저장했어요. 폴더 이름은 DIOS-프로젝트-스킬 안의 JuPlan이에요. 그 안의 첫 글을 Aside에게 주면 돼요.')
    expect(saved.folder).toBe(path.join(desktop, 'DIOS-프로젝트-스킬', 'JuPlan'))
    const names = fs.readdirSync(saved.folder).sort()
    expect(names).toEqual(['00-Aside에게-검토-맡기기.md', '01-founder-ux.md'])
    const sheet = fs.readFileSync(path.join(saved.folder, names[0]), 'utf8')
    expect(sheet).toContain('JuPlan 프로젝트')
    expect(sheet).toContain('01-founder-ux.md — founder-ux — 계획, 만들기')
    const note = fs.readFileSync(path.join(saved.folder, names[1]), 'utf8')
    expect(note).toContain('쓰는 단계: 계획, 만들기')
    expect(note).toContain('본문')

    setProjectSkill(home, 'JuPlan', 'founder-ux', false)
    const empty = saveProjectSkillPack(home, 'JuPlan', desktop)
    expect(empty.ok).toBe(false)
    expect(empty.message).toContain('켜 둔 스킬이 없어요')
    expect(saveProjectSkillPack(home, '없는 프로젝트', desktop).ok).toBe(false)
  })

  it('leaves out a skill whose text is nowhere on this computer', () => {
    const home = makeHome()
    const desktop = path.join(home, 'Desktop')
    fs.mkdirSync(desktop, { recursive: true })
    const gone = saveProjectSkillPack(home, 'Dios', desktop)
    expect(gone.ok).toBe(false)
    expect(gone.message).toContain('하나도 찾지 못했어요')
    expect(fs.existsSync(path.join(desktop, 'DIOS-프로젝트-스킬'))).toBe(false)
  })

  it('says when the name does not match a project', () => {
    const home = makeHome()
    expect(listProjectSkills(home, '없는 프로젝트').matched).toBe(false)
    expect(listProjectSkills(home, '없는 프로젝트').skills).toEqual([])
  })
})
