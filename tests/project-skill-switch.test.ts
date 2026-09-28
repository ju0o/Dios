import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProjectSkills, setProjectSkill } from '../src/core/skill-board/project-skill-switch'

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

  it('says when the name does not match a project', () => {
    const home = makeHome()
    expect(listProjectSkills(home, '없는 프로젝트').matched).toBe(false)
    expect(listProjectSkills(home, '없는 프로젝트').skills).toEqual([])
  })
})
