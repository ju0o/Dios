import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import remoteScript from '../src/core/skill-board/remote.py?raw'
import { loadBoard } from '../src/core/skill-board/model'
import { explainFailure, parseSshHosts } from '../src/core/skill-board/places'

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-remote-'))
  const skill = path.join(home, '.agents', 'skills', 'demo-skill')
  fs.mkdirSync(skill, { recursive: true })
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: demo-skill\ndescription: Send it. 대표님이 직접 해야 할 일을 정리해요.\n---\n\n- 브라우저 일은 Aside에게 보내요.\n- 명령은 대표님 폴더에 적어요.\n')
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
  return home
}

type Board = ReturnType<typeof loadBoard>

function runPython(home: string, args: string[]): { ok?: boolean; message?: string; board: Board } {
  const out = execFileSync('python3', ['-', ...args], {
    input: remoteScript,
    env: { ...process.env, HOME: home, DIOS_HOME: home },
    encoding: 'utf8',
  })
  const parsed = JSON.parse(out)
  // `board` prints the board itself; the other commands wrap it in a result.
  return args[0] === 'board' ? { board: parsed as Board } : parsed
}

const hasPython = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('remote helper matches the local model', () => {
  it.skipIf(!hasPython)('reads the same board shape', () => {
    const home = makeHome()
    const fromPython = runPython(home, ['board']).board
    const fromNode = loadBoard(home)
    expect(fromPython.agents.map((agent) => [agent.id, agent.ready])).toEqual(fromNode.agents.map((agent) => [agent.id, agent.ready]))
    expect(fromPython.skills[0].summary).toBe(fromNode.skills[0].summary)
    expect(fromPython.skills[0].steps).toEqual(fromNode.skills[0].steps)
  })

  it.skipIf(!hasPython)('links, notices an edit, and unlinks', () => {
    const home = makeHome()
    const linked = runPython(home, ['link', 'codex', 'demo-skill'])
    expect(linked.ok).toBe(true)
    expect(fs.lstatSync(path.join(home, '.codex', 'skills', 'demo-skill')).isSymbolicLink()).toBe(true)
    expect(loadBoard(home).skills[0].agents).toContain('codex')

    fs.appendFileSync(path.join(home, '.agents', 'skills', 'demo-skill', 'SKILL.md'), '- 부족한 보고는 실패로 보관해요.\n')
    expect(runPython(home, ['board']).board.skills[0].changed).toBe(true)
    expect(runPython(home, ['ack', 'demo-skill']).board.skills[0].changed).toBe(false)

    const removed = runPython(home, ['unlink', 'codex', 'demo-skill'])
    expect(removed.ok).toBe(true)
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
  })

  it.skipIf(!hasPython)('registers a skill from a staged pack', () => {
    const home = makeHome()
    fs.writeFileSync(path.join(home, '.dios-pack.json'), JSON.stringify({
      name: 'weekly-report',
      summary: '매주 보고서를 정리해요.',
      steps: ['지난 주를 적어요'],
    }))
    const created = runPython(home, ['create'])
    expect(created.ok).toBe(true)
    expect(created.board.skills.some((skill) => skill.name === 'weekly-report')).toBe(true)
    expect(fs.existsSync(path.join(home, '.dios-pack.json'))).toBe(false)
  })

  it.skipIf(!hasPython)('attaches a new skill only where that agent is ready', () => {
    const home = makeHome()
    fs.writeFileSync(path.join(home, '.dios-pack.json'), JSON.stringify({
      name: 'weekly-report',
      summary: '매주 보고서를 정리해요.',
      steps: ['지난 주를 적어요'],
      agentIds: ['codex', 'claude'],
    }))
    const created = runPython(home, ['create'])
    expect(created.ok).toBe(true)
    expect(created.message).toContain('Codex에 붙였어요')
    expect(created.message).toContain('빼 둔 곳: Claude')
    expect(fs.lstatSync(path.join(home, '.codex', 'skills', 'weekly-report')).isSymbolicLink()).toBe(true)
    expect(fs.existsSync(path.join(home, '.claude', 'skills', 'weekly-report'))).toBe(false)
  })

  it.skipIf(!hasPython)('keeps a Korean copy sent from another computer only for the same English text', () => {
    const home = makeHome()
    const print = runPython(home, ['board']).board.skills[0].print
    const env = { ...process.env, HOME: home, DIOS_HOME: home }
    const read = () => JSON.parse(execFileSync('python3', ['-', 'translation', 'demo-skill'], { input: remoteScript, env, encoding: 'utf8' }))
    expect(read().ok).toBe(false)

    fs.writeFileSync(path.join(home, '.dios-pack.json'), JSON.stringify({ name: 'demo-skill', print: 'stale', text: '---\ndescription: 옛 글\n---\n' }))
    expect(runPython(home, ['settranslation']).ok).toBe(false)
    expect(read().ok).toBe(false)

    fs.writeFileSync(path.join(home, '.dios-pack.json'), JSON.stringify({ name: 'demo-skill', print, text: '---\nname: demo-skill\ndescription: 보고를 짧게 정리해요.\n---\n# 데모\n' }))
    expect(runPython(home, ['settranslation']).ok).toBe(true)
    expect(read()).toMatchObject({ ok: true, print })
    expect(runPython(home, ['board']).board.skills[0].koreanSummary).toBe('보고를 짧게 정리해요.')
  })

  it.skipIf(!hasPython)('gives the same text fingerprint as the local model', () => {
    const home = makeHome()
    expect(runPython(home, ['board']).board.skills[0].print).toBe(loadBoard(home).skills[0].print)
  })

  it.skipIf(!hasPython)('keeps history, restores, trashes, and brings back', () => {
    const home = makeHome()
    const skillFile = path.join(home, '.agents', 'skills', 'demo-skill', 'SKILL.md')
    const original = fs.readFileSync(skillFile, 'utf8')
    fs.writeFileSync(path.join(home, '.dios-pack.json'), JSON.stringify({ name: 'demo-skill', text: `${original}- 새 줄이에요.\n` }))
    expect(runPython(home, ['save']).ok).toBe(true)
    const history = JSON.parse(execFileSync('python3', ['-', 'history', 'demo-skill'], { input: remoteScript, env: { ...process.env, HOME: home, DIOS_HOME: home }, encoding: 'utf8' }))
    expect(history.versions).toHaveLength(1)
    expect(runPython(home, ['restore', 'demo-skill', history.versions[0].id]).ok).toBe(true)
    expect(fs.readFileSync(skillFile, 'utf8')).toBe(original)

    runPython(home, ['link', 'codex', 'demo-skill'])
    const trashed = runPython(home, ['trash', 'demo-skill'])
    expect(trashed.ok).toBe(true)
    expect(fs.existsSync(skillFile)).toBe(false)
    const list = JSON.parse(execFileSync('python3', ['-', 'trashlist'], { input: remoteScript, env: { ...process.env, HOME: home, DIOS_HOME: home }, encoding: 'utf8' }))
    expect(list.items[0].agents).toEqual(['codex'])
    const back = runPython(home, ['untrash', list.items[0].id])
    expect(back.ok).toBe(true)
    expect(back.board.skills[0].agents).toContain('codex')
  })

  it.skipIf(!hasPython)('attaches several agents in one call', () => {
    const home = makeHome()
    const attached = runPython(home, ['attach', 'demo-skill', 'codex,grok'])
    expect(attached.message).toBe('Codex에 붙였어요. 빼 둔 곳: Grok.')
  })
})

describe('places', () => {
  it('reads ssh hosts and skips patterns', () => {
    expect(parseSshHosts('Host asus\n  HostName 1.2.3.4\nHost *\n  User x\nHost main my-aws\nHost git?\n')).toEqual(['asus', 'main', 'my-aws'])
  })

  it('explains failures in one Korean line', () => {
    const place = { id: 'ssh:asus', name: 'asus (SSH)', kind: 'ssh' as const, target: 'asus' }
    expect(explainFailure(place, new Error('ssh: connect to host asus: Connection timed out'))).toContain('꺼져')
    expect(explainFailure(place, new Error('Permission denied (publickey)'))).toContain('열쇠')
  })
})
