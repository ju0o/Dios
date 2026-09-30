import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseGate, resultNote, workHeadline } from '../src/core/founder-work/parse-gate'
import { dismissOpenFile, finishOpenFile, restoreOpenFile, safeSeg, unfinishOpenFile } from '../src/core/founder-work/dismiss'
import { readReport } from '../src/core/founder-work/read-report'

const ASIDE = `# 요청: 댓글 리포트 탭 재확인

이 결과를 돌려줄 에이전트: Codex · ASUS
프로젝트: JuRadar · 작업: JURADAR-UI-20260928

## 무엇을 하면 되나
댓글과 리포트가 각각 열리는지 확인해 주세요.

## 이렇게 진행해
1. 배포본을 먼저 배포하세요.
2. 게시물·댓글·리포트 버튼을 각각 두 번 클릭하세요.

<details><summary>원문 보기 (개발용)</summary>

gateId: HG-20260928-62ecab · project: juradar · goal: - · task: JURADAR-UI-20260928 · 만든 AI: Codex · 09-28 15:10

</details>
`

const FOUNDER = `# 대표님이 직접 하는 일: ASUS 워커 기동 후 재검증

이 결과를 돌려줄 에이전트: Codex · ASUS
프로젝트: JuRadar · 작업: JURADAR-CONTENT

워커를 켜고 초안이 나왔는지 봐 주세요.

## 이렇게 하세요
1. ASUS 기기를 켜 주세요.
2. 관리자 화면에서 결과를 확인해 주세요.

## 붙여 넣을 명령
\`\`\`bash
agent-relay portfolio founder-response FG-80bd APPROVE
\`\`\`

## 이렇게 나오면 성공
RECORDED 가 보이면 성공
`

function tempRoot(): { root: string; aside: string; founder: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-work-'))
  const aside = path.join(root, '00_NOW', 'Aside')
  const founder = path.join(root, '00_NOW', 'Founder')
  fs.mkdirSync(aside, { recursive: true })
  fs.mkdirSync(founder, { recursive: true })
  return { root, aside, founder }
}

describe('founder work cards', () => {
  it('reads an Aside prompt into a sentence the Founder can say', () => {
    const card = parseGate(ASIDE, 'aside', '댓글.md', 1)
    expect(card.title).toBe('댓글 리포트 탭 재확인')
    expect(card.project).toBe('JuRadar')
    expect(card.agent).toBe('Codex · ASUS')
    expect(card.steps).toHaveLength(2)
    expect(card.gateId).toBe('HG-20260928-62ecab')
    expect(card.commands).toEqual([])
    expect(card.sayToAside).toBe('Aside에게 "댓글 리포트 탭 재확인 해 줘"라고 말하면 돼요.')
    expect(card.prompt).toContain('## 이렇게 진행해')
    expect(card.prompt).toContain('gateId: HG-20260928-62ecab')
    expect(card.prompt.startsWith('# 요청:')).toBe(true)
  })

  it('reads a Founder task with its command and success line', () => {
    const card = parseGate(FOUNDER, 'founder', '워커.md')
    expect(card.title).toBe('ASUS 워커 기동 후 재검증')
    expect(card.summary).toContain('초안')
    expect(card.sayToAside).toBe('')
    expect(card.prompt).toContain('## 붙여 넣을 명령')
    expect(card.steps[0]).toContain('ASUS')
    expect(card.commands).toEqual(['agent-relay portfolio founder-response FG-80bd APPROVE'])
    expect(card.success).toContain('RECORDED')
  })

  it('sums the top line and reads both result formats', () => {
    expect(workHeadline(0, 0)).toContain('하실 일은 없어요')
    expect(workHeadline(5, 6)).toBe('지금 할 일 11개. Aside에게 말할 것 5개, 직접 하실 일 6개.')
    expect(resultNote('- 한 것: 댓글 화면이 열렸어요.\n- 결과: 없음\n')).toBe('댓글 화면이 열렸어요.')
    expect(resultNote('# DONE · HG-1\n작업: x\n\n## Agent가 받은 결과 보고\n링크를 올렸어요.\n')).toBe('링크를 올렸어요.')
    expect(safeSeg('JURADAR-UI 2026/09')).toBe('JURADAR-UI_202609')
  })
})

describe('founder work folder', () => {
  it('lists open tasks and keeps a result note on the finished one', () => {
    const { root, aside } = tempRoot()
    const done = path.join(root, '01_ARCHIVE', 'JuRadar', 'DONE', '2026-09-28', '탭')
    fs.mkdirSync(done, { recursive: true })
    fs.writeFileSync(path.join(aside, '댓글.md'), ASIDE)
    fs.writeFileSync(path.join(aside, 'skip.js'), 'nope')
    fs.writeFileSync(path.join(done, '끝난일.md'), '# 요청: 대시보드 확인\n프로젝트: JuRadar\n')
    fs.writeFileSync(path.join(done, 'RESULT.md'), 'HG-1\n- 한 것: 화면이 열렸어요.\n')
    const work = readReport(root)
    expect(work.found).toBe(true)
    expect(work.open.map((task) => task.title)).toEqual(['댓글 리포트 탭 재확인'])
    expect(work.done[0]).toMatchObject({ project: 'JuRadar', title: '대시보드 확인', note: '화면이 열렸어요.' })
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('drops a task the Founder will not do, leaves a line for the relay, and can put it back', () => {
    const { root, aside } = tempRoot()
    fs.writeFileSync(path.join(aside, '댓글.md'), ASIDE)
    const task = readReport(root).open[0]
    const moved = dismissOpenFile(root, task)
    expect(moved.ok).toBe(true)
    expect(readReport(root).open).toHaveLength(0)
    const list = path.join(root, '00_NOW', '_안함', '안함.jsonl')
    const line = JSON.parse(fs.readFileSync(list, 'utf8').trim())
    expect(line).toMatchObject({ gateId: 'HG-20260928-62ecab', project: 'JuRadar', kind: 'web', title: '댓글 리포트 탭 재확인' })
    expect(restoreOpenFile(root, task, moved.from, moved.to).ok).toBe(true)
    expect(readReport(root).open.map((item) => item.title)).toEqual(['댓글 리포트 탭 재확인'])
    expect(fs.readFileSync(list, 'utf8').trim()).toBe('')
    expect(dismissOpenFile(root, { ...task, fileName: '../비밀.md' }).ok).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('files a pasted result as DONE with a RESULT.md and a signal, and can undo', () => {
    const { root, founder } = tempRoot()
    fs.writeFileSync(path.join(founder, '워커.md'), FOUNDER)
    const task = readReport(root).open[0]
    const moved = finishOpenFile(root, task, 'RECORDED 나왔어요.')
    expect(moved.ok).toBe(true)
    expect(moved.to).toContain(path.join('01_ARCHIVE', 'JuRadar', 'DONE'))
    expect(moved.to).toContain('JURADAR-CONTENT')
    const after = readReport(root)
    expect(after.open).toHaveLength(0)
    expect(after.done[0]).toMatchObject({ project: 'JuRadar', title: 'ASUS 워커 기동 후 재검증', note: 'RECORDED 나왔어요.' })
    const signals = fs.readdirSync(path.join(root, '00_NOW', '_결과'))
    expect(signals).toHaveLength(1)
    expect(JSON.parse(fs.readFileSync(path.join(root, '00_NOW', '_결과', signals[0]), 'utf8'))).toMatchObject({ kind: 'cli', note: 'RECORDED 나왔어요.', task: 'JURADAR-CONTENT' })
    expect(unfinishOpenFile(root, task, moved.from, moved.to).ok).toBe(true)
    expect(readReport(root).open).toHaveLength(1)
    expect(readReport(root).done).toHaveLength(0)
    expect(fs.readdirSync(path.join(root, '00_NOW', '_결과'))).toHaveLength(0)
    fs.rmSync(root, { recursive: true, force: true })
  })
})
