import { describe, expect, it } from 'vitest'
import { changesHeadline, fileChangesHeadline, parseGitStatus, skillChangeLine, skillChanges, skillUndoPlan, testHeadline } from '../src/core/changes/changes-copy'
import { canOpenProject, openProjectMessage, projectIdForName, projectWorkCount, projectWorkLine } from '../src/core/project-home/open-project'

describe('undoing one skill change', () => {
  it('reverses plain on/off rows for projects and agents', () => {
    expect(skillUndoPlan('프로젝트에 스킬 붙이기', 'JuPlan · founder-ux')).toEqual({ target: 'project', place: 'JuPlan', skill: 'founder-ux', on: false, doneLine: 'JuPlan에서 founder-ux을 다시 뺐어요.' })
    expect(skillUndoPlan('에이전트에서 스킬 빼기', 'Claude · demo-skill')).toMatchObject({ target: 'agent', place: 'Claude', skill: 'demo-skill', on: true })
  })

  it('offers nothing for rows that are not an on/off, or lack a place', () => {
    expect(skillUndoPlan('프로젝트 스킬 글 바탕화면에 저장', 'JuPlan')).toBeNull()
    expect(skillUndoPlan('프로젝트에 스킬 붙이기', 'founder-ux')).toBeNull()
    const rows = skillChanges([{ id: 'a', type: 'skill', title: '스킬 받기', description: 'x', createdAt: 1 }])
    expect(rows[0].undo).toBeNull()
  })
})

describe('open work on the project home', () => {
  it('counts only this project, matching names loosely', () => {
    const open = [{ project: 'JuPlan' }, { project: 'ju-plan' }, { project: 'JuRadar' }]
    expect(projectWorkCount(open, 'Ju Plan')).toBe(2)
    expect(projectWorkCount(open, '')).toBe(0)
    expect(projectWorkLine('JuPlan', 2)).toBe('JuPlan에서 기다리는 일이 2개 있어요.')
    expect(projectWorkLine('JuPlan', 0)).toBe('JuPlan에서 지금 기다리는 일은 없어요.')
  })
})

describe('skill change history', () => {
  it('turns stored rows into one Korean line each, newest first, skills only', () => {
    const rows = skillChanges([
      { id: 'a', type: 'skill', title: '프로젝트에 스킬 붙이기', description: 'JuPlan · founder-ux', createdAt: 10 },
      { id: 'b', type: 'test', title: '테스트 통과', description: '/x', createdAt: 20 },
      { id: 'c', type: 'skill', title: '에이전트에서 스킬 빼기', description: 'Claude · demo-skill', createdAt: 30 },
    ])
    expect(rows.map((row) => row.id)).toEqual(['c', 'a'])
    expect(rows[0].line).toBe('Claude에서 demo-skill 뺌')
    expect(rows[1].line).toBe('JuPlan에 founder-ux 붙임')
  })

  it('still reads rows written before the place was stored', () => {
    expect(skillChangeLine('프로젝트에 스킬 붙이기', 'founder-ux')).toBe('founder-ux 프로젝트에 붙임')
    expect(skillChangeLine('프로젝트 스킬 글 바탕화면에 저장', 'JuPlan')).toBe('JuPlan의 스킬 글을 바탕화면에 저장함')
    expect(skillChangeLine('스킬 받기', 'new-skill')).toBe('new-skill 받음')
    expect(skillChangeLine('낯선 제목', '설명')).toBe('낯선 제목 · 설명')
  })
})

describe('file changes in plain words', () => {
  it('groups git status lines and counts them in one sentence', () => {
    const files = parseGitStatus(' M src/a.ts\n?? new.md\nD  gone.txt\nR  old.ts -> renamed.ts\nA  added.ts\n')
    expect(files).toEqual({ added: ['new.md', 'added.ts'], changed: ['src/a.ts'], removed: ['gone.txt'], renamed: ['renamed.ts'] })
    expect(fileChangesHeadline(files, true)).toBe('바뀐 파일 5개예요. 새 파일 2개, 고친 파일 1개, 지운 파일 1개, 이름 바꾼 파일 1개.')
    expect(fileChangesHeadline(parseGitStatus(''), true)).toContain('바뀐 파일이 없어요')
    expect(fileChangesHeadline(null, false)).toContain('아직 안 봤어요')
  })

  it('says what the tests did without English', () => {
    expect(testHeadline(null, false)).toContain('아직 시험을 안 돌렸어요')
    expect(testHeadline(null, true)).toContain('돌리고 있어요')
    expect(testHeadline({ success: true }, false)).toBe('시험을 통과했어요.')
    expect(testHeadline({ success: false }, false)).toContain('실패했어요')
    expect(changesHeadline('', 0)).toContain('자료 스캔')
    expect(changesHeadline('', 3)).toContain('3개')
    expect(changesHeadline('Dios', 2)).toBe('Dios 폴더의 파일 변화와 스킬을 켜고 끈 기록 2개를 여기서 봐요.')
  })
})

describe('opening a project home from the usage screen', () => {
  const projects = [{ id: 'p1', name: 'Agent Relay' }, { id: 'p2', name: 'JuPlan' }]

  it('matches names loosely and skips rows that are not one project', () => {
    expect(projectIdForName(projects, 'agent-relay')).toBe('p1')
    expect(projectIdForName(projects, ' juplan ')).toBe('p2')
    expect(projectIdForName(projects, 'JuCeipt')).toBe('')
    expect(canOpenProject('JuPlan')).toBe(true)
    expect(canOpenProject('홈 폴더')).toBe(false)
    expect(canOpenProject('여러 프로젝트 폴더')).toBe(false)
  })

  it('tells the Founder what happened on arrival', () => {
    expect(openProjectMessage('JuPlan', true, false)).toBe('사용량에서 온 JuPlan 홈이에요.')
    expect(openProjectMessage('JuCeipt', false, true)).toContain('아래에서 만들면')
    expect(openProjectMessage('Other', false, false)).toContain('같은 이름으로 만들면')
  })
})
