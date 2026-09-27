import fs from 'fs'
import os from 'os'
import path from 'path'
import { acknowledgeSkill, applyRelay, lineDiff, linkSkill, loadBoard, skillStory, unlinkSkill } from '../src/core/skill-board/model'
import { createSkill, exportSkill, importSkill, saveSkillText, setGuide, attachSummary, sameSkillText } from '../src/core/skill-board/library'

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-skill-'))
  const skill = path.join(home, '.agents', 'skills', 'demo-skill')
  fs.mkdirSync(skill, { recursive: true })
  fs.writeFileSync(path.join(skill, 'SKILL.md'), `---
name: demo-skill
description: 대표님이 직접 해야 할 일을 정리해요.
---

# 안내

- 브라우저 일은 Aside에게 보내요.
- 명령은 대표님 폴더에 적어요.
- 보고가 오면 날짜별로 보관해요.
`)
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.mkdirSync(path.join(home, '.local', 'share', 'AgentRelay', 'night-runtime', 'config'), { recursive: true })
  fs.writeFileSync(path.join(home, '.local', 'share', 'AgentRelay', 'night-runtime', 'config', 'portfolio.json'), JSON.stringify({
    projects: [{ id: 'alpha', skills: { pm: ['founder-ux'], worker: ['founder-ux'] }, title: '그대로' }],
  }, null, 2))
  return home
}

describe('skill board', () => {
  it('reads a Korean summary and steps', () => {
    const story = skillStory('---\ndescription: Send the gate.\n---\n- 브라우저 일은 Aside에게 보내요.\n')
    expect(story.summary).toBe('')
    expect(story.steps[0]).toContain('Aside')
    const mixed = skillStory('---\ndescription: Send it. 대표님이 직접 해야 할 일을 정리해요.\n---\n- Browser only\n')
    expect(mixed.summary).toContain('대표님')
    const englishWithPath = skillStory('---\ndescription: Web work goes to Aside\\아직_해야할_일. The file names you.\n---\n')
    expect(englishWithPath.summary).toBe('')
  })

  it('links and unlinks without deleting the skill text', () => {
    const home = makeHome()
    const linked = linkSkill(home, 'claude', 'demo-skill')
    expect(linked.ok).toBe(true)
    expect(linked.board.agents.find((agent) => agent.id === 'claude')?.skillNames).toContain('demo-skill')
    expect(fs.lstatSync(path.join(home, '.claude', 'skills', 'demo-skill')).isSymbolicLink()).toBe(true)

    const removed = unlinkSkill(home, 'claude', 'demo-skill')
    expect(removed.ok).toBe(true)
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(home, '.claude', 'skills', 'demo-skill'))).toBe(false)
  })

  it('refuses to remove a real skill folder', () => {
    const home = makeHome()
    const copy = path.join(home, '.claude', 'skills', 'demo-skill')
    fs.mkdirSync(copy, { recursive: true })
    fs.writeFileSync(path.join(copy, 'SKILL.md'), 'keep')
    const removed = unlinkSkill(home, 'claude', 'demo-skill')
    expect(removed.ok).toBe(false)
    expect(fs.existsSync(path.join(copy, 'SKILL.md'))).toBe(true)
  })

  it('notices a later edit and clears it when acknowledged', () => {
    const home = makeHome()
    expect(loadBoard(home).skills[0].changed).toBe(false)
    fs.appendFileSync(path.join(home, '.agents', 'skills', 'demo-skill', 'SKILL.md'), '\n- 부족한 보고는 실패로 보관해요.\n')
    const changed = loadBoard(home).skills[0]
    expect(changed.changed).toBe(true)
    expect(changed.addedLines.some((line) => line.includes('실패'))).toBe(true)
    expect(acknowledgeSkill(home, 'demo-skill').board.skills[0].changed).toBe(false)
  })

  it('adds a relay skill without dropping other fields', () => {
    const portfolio = { projects: [{ id: 'alpha', title: '그대로', skills: { pm: ['founder-ux'] } }] }
    expect(applyRelay(portfolio, 'demo-skill', true)).toBe(1)
    expect(portfolio.projects[0].skills.pm).toEqual(['founder-ux', 'demo-skill'])
    expect(portfolio.projects[0].title).toBe('그대로')
    expect(applyRelay(portfolio, 'demo-skill', false)).toBe(1)
    expect(portfolio.projects[0].skills.pm).toEqual(['founder-ux'])
  })

  it('describes a text change as added and removed lines', () => {
    expect(lineDiff('같은 줄\n빠진 줄', '같은 줄\n새 줄').added).toEqual(['새 줄'])
    expect(lineDiff('같은 줄\n빠진 줄', '같은 줄\n새 줄').removed).toEqual(['빠진 줄'])
  })
})

describe('skill library', () => {
  it('registers a skill, edits it, and sends a copy without deleting the source', () => {
    const home = makeHome()
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-other-'))
    const created = createSkill(home, 'weekly-report', '매주 보고서를 정리해요.', ['지난 주를 적어요', '링크를 넣어요'])
    expect(created.ok).toBe(true)
    expect(loadBoard(home).skills.some((skill) => skill.name === 'weekly-report' && skill.summary.includes('보고서'))).toBe(true)

    const file = path.join(home, '.agents', 'skills', 'weekly-report', 'SKILL.md')
    const saved = saveSkillText(home, 'weekly-report', `${fs.readFileSync(file, 'utf8')}\n- 확인까지 적어요\n`)
    expect(saved.message).toContain('1줄이 들어오고')
    expect(loadBoard(home).skills.find((skill) => skill.name === 'weekly-report')?.changed).toBe(false)

    const pack = exportSkill(home, 'weekly-report').pack
    expect(pack).toBeTruthy()
    expect(importSkill(other, pack!, false).ok).toBe(true)
    expect(importSkill(other, pack!, false).message).toBe('이미 있어요.')
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'weekly-report', 'SKILL.md'))).toBe(true)
  })

  it('turns the chat guide on and off without removing other text', () => {
    const home = makeHome()
    const claude = path.join(home, '.claude', 'CLAUDE.md')
    fs.writeFileSync(claude, '다른 안내\n')
    expect(setGuide(home, 'claude', true).ok).toBe(true)
    expect(loadBoard(home).agents.find((agent) => agent.id === 'claude')?.guideOn).toBe(true)
    expect(fs.readFileSync(claude, 'utf8')).toContain('다른 안내')
    expect(setGuide(home, 'claude', false).ok).toBe(true)
    expect(fs.readFileSync(claude, 'utf8').trim()).toBe('다른 안내')
    expect(loadBoard(home).agents.find((agent) => agent.id === 'claude')?.guideOn).toBe(false)
  })

  it('names who was attached and treats matching skill text as the same', () => {
    expect(attachSummary(['Claude', 'Codex'], ['Grok'])).toBe('Claude, Codex에 붙였어요. 빼 둔 곳: Grok.')
    expect(sameSkillText('같은 글\n', '같은 글')).toBe(true)
    const story = skillStory(`---\ndescription: 한글 설명이에요.\n---\n- ${'가'.repeat(50)}\n`)
    expect(story.fullSteps[0].length).toBeGreaterThan(story.steps[0].length)
  })
})
