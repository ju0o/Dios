/** One row DIOS wrote when something happened, as stored in the activity table. */
export interface ActivityRow {
  id: string
  type: string
  title: string
  description: string
  createdAt: number
}

/** What pressing 되돌리기 on one history line should do. */
export interface SkillUndo {
  /** Project rows go through the project on/off list; agent rows through the skill board link. */
  target: 'project' | 'agent'
  /** Project label or agent name exactly as the row stored it. */
  place: string
  skill: string
  /** The state to put back: true means attach again, false means detach again. */
  on: boolean
  /** "JuPlan에서 founder-ux 다시 뺐어요" style sentence shown after it worked. */
  doneLine: string
}

/** One line on the 변경사항 screen about a skill that was turned on or off. */
export interface SkillChange {
  id: string
  /** "JuPlan에 founder-ux 붙임" style sentence. */
  line: string
  createdAt: number
  /** Present only when the row is a plain on/off that can be reversed. */
  undo: SkillUndo | null
}

/** Files git reports, grouped the way the Founder reads them. */
export interface FileChanges {
  added: string[]
  changed: string[]
  removed: string[]
  renamed: string[]
}

const CHANGE_LIMIT = 30

/** Skill rows only, newest first, each turned into one Korean sentence. */
export function skillChanges(rows: ActivityRow[]): SkillChange[] {
  return rows
    .filter((row) => row.type === 'skill')
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, CHANGE_LIMIT)
    .map((row) => ({ id: row.id, line: skillChangeLine(row.title, row.description), createdAt: row.createdAt, undo: skillUndoPlan(row.title, row.description) }))
}

/** The reverse of one on/off row, or null when the row is not something DIOS can undo. */
export function skillUndoPlan(title: string, description: string): SkillUndo | null {
  const [place = '', skill = ''] = description.split('·').map((part) => part.trim())
  if (!place || !skill) return null
  switch (title) {
    case '프로젝트에 스킬 붙이기': return { target: 'project', place, skill, on: false, doneLine: `${place}에서 ${skill}을 다시 뺐어요.` }
    case '프로젝트에서 스킬 빼기': return { target: 'project', place, skill, on: true, doneLine: `${place}에 ${skill}을 다시 붙였어요.` }
    case '에이전트에 스킬 붙이기': return { target: 'agent', place, skill, on: false, doneLine: `${place}에서 ${skill}을 다시 뺐어요.` }
    case '에이전트에서 스킬 빼기': return { target: 'agent', place, skill, on: true, doneLine: `${place}에 ${skill}을 다시 붙였어요.` }
    default: return null
  }
}

/** "JuPlan에 founder-ux 붙임" from the stored title and "JuPlan · founder-ux" description. */
export function skillChangeLine(title: string, description: string): string {
  const [where = '', what = ''] = description.split('·').map((part) => part.trim())
  const target = what || where
  const place = what ? where : ''
  switch (title) {
    case '프로젝트에 스킬 붙이기': return place ? `${place}에 ${target} 붙임` : `${target} 프로젝트에 붙임`
    case '프로젝트에서 스킬 빼기': return place ? `${place}에서 ${target} 뺌` : `${target} 프로젝트에서 뺌`
    case '에이전트에 스킬 붙이기': return place ? `${place}에 ${target} 붙임` : `${target} 에이전트에 붙임`
    case '에이전트에서 스킬 빼기': return place ? `${place}에서 ${target} 뺌` : `${target} 에이전트에서 뺌`
    case '프로젝트 스킬 글 바탕화면에 저장': return `${target}의 스킬 글을 바탕화면에 저장함`
    case '스킬 받기': return `${target} 받음`
    case '스킬 폴더 추가': return `폴더에서 스킬 추가함`
    case '다른 컴퓨터에서 스킬 가져오기': return `${target} 다른 컴퓨터에서 가져옴`
    case '스킬 모으기': return '한 곳에만 있던 스킬을 공용 폴더로 모음'
    default: return description ? `${title} · ${description}` : title
  }
}

/** Group `git status --short` lines. Paths stay as git wrote them; the screen folds them under 원문 보기. */
export function parseGitStatus(status: string): FileChanges {
  const out: FileChanges = { added: [], changed: [], removed: [], renamed: [] }
  for (const raw of status.split(/\r?\n/)) {
    if (raw.length < 3) continue
    const code = raw.slice(0, 2)
    const file = raw.slice(3).trim()
    if (!file) continue
    if (code === '??' || code.includes('A')) out.added.push(file)
    else if (code.includes('D')) out.removed.push(file)
    else if (code.includes('R')) out.renamed.push(file.split(' -> ').pop() ?? file)
    else out.changed.push(file)
  }
  return out
}

/** One sentence for the top of the files section. */
export function fileChangesHeadline(changes: FileChanges | null, checked: boolean): string {
  if (!checked || !changes) return '아직 안 봤어요. 위의 단추를 누르면 작업 폴더에서 무엇이 바뀌었는지 읽어요.'
  const total = changes.added.length + changes.changed.length + changes.removed.length + changes.renamed.length
  if (!total) return '바뀐 파일이 없어요. 마지막으로 저장한 뒤로 그대로예요.'
  const parts: string[] = []
  if (changes.added.length) parts.push(`새 파일 ${changes.added.length}개`)
  if (changes.changed.length) parts.push(`고친 파일 ${changes.changed.length}개`)
  if (changes.removed.length) parts.push(`지운 파일 ${changes.removed.length}개`)
  if (changes.renamed.length) parts.push(`이름 바꾼 파일 ${changes.renamed.length}개`)
  return `바뀐 파일 ${total}개예요. ${parts.join(', ')}.`
}

/** One sentence for the tests section. */
export function testHeadline(result: { success: boolean } | null, running: boolean): string {
  if (running) return '시험을 돌리고 있어요. 조금 걸릴 수 있어요.'
  if (!result) return '아직 시험을 안 돌렸어요. 위의 단추를 누르면 이 폴더의 시험을 돌려요.'
  return result.success ? '시험을 통과했어요.' : '시험이 실패했어요. 아래 원문 보기에 실패한 줄이 있어요.'
}

/** The top line of the whole screen. */
export function changesHeadline(rootName: string, skillCount: number): string {
  if (!rootName) return skillCount ? `스킬을 켜고 끈 기록 ${skillCount}개가 있어요. 파일 변화까지 보려면 자료 스캔에서 작업 폴더를 연결해 주세요.` : '아직 연결한 작업 폴더가 없어요. 자료 스캔에서 폴더를 연결하면 여기서 바뀐 파일을 볼 수 있어요.'
  return skillCount ? `${rootName} 폴더의 파일 변화와 스킬을 켜고 끈 기록 ${skillCount}개를 여기서 봐요.` : `${rootName} 폴더에서 무엇이 바뀌었는지 여기서 봐요.`
}
