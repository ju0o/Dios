/** One open task the Founder can see. The file path stays off this card. */
export interface OpenTask {
  kind: 'aside' | 'founder'
  title: string
  project: string
  task: string
  /** Who should hear the result, for example "Codex · ASUS". */
  agent: string
  summary: string
  steps: string[]
  /** Lines to paste into a terminal, from the guide's command block. */
  commands: string[]
  /** What the screen shows when it worked. */
  success: string
  /** Sentence to say to Aside. Empty for Founder tasks. The copy button uses `prompt`, not this line. */
  sayToAside: string
  /** The gate file itself, so a copy button can paste the whole prompt. */
  prompt: string
  /** Relay id such as HG-20260928-62ecab, kept for the relay script. Never shown on the card. */
  gateId: string
  fileName: string
  updatedAt: number
}

/** One finished or blocked task from the archive. */
export interface PastTask {
  status: 'done' | 'blocked'
  project: string
  title: string
  note: string
  updatedAt: number
}

const ASIDE_PREFIX = /^(요청:\s*|대표님이 직접 하는 일:\s*)/
const AGENT_LINE = /이 결과를 돌려줄 에이전트:\s*(.+)/
const PROJECT_LINE = /프로젝트:\s*([^·\n]+?)(?:\s*·\s*작업:\s*([^\n]+))?$/m
const GATE_ID = /gateId:\s*(HG-[0-9]{8}-[0-9a-z]{4,8})/i
const RESULT_HEADING = 'Agent가 받은 결과 보고'

/** Turn one gate file into a card. `kind` comes from the folder it was found in. */
export function parseGate(text: string, kind: 'aside' | 'founder', fileName: string, updatedAt = 0): OpenTask {
  const clean = text.replace(/^\uFEFF/, '')
  const title = cleanTitle(firstHeading(clean) || fileName.replace(/\.md$/i, '').replace(/_/g, ' '))
  const agent = (clean.match(AGENT_LINE)?.[1] ?? '').trim()
  const projectMatch = clean.match(PROJECT_LINE)
  const project = (projectMatch?.[1] ?? '').trim() || '기타'
  const task = (projectMatch?.[2] ?? '').trim()
  const summary = sectionBody(clean, ['무엇을 하면 되나']) || firstParagraph(clean)
  const steps = stepsIn(clean, kind === 'aside' ? ['이렇게 진행해', '이렇게 하세요'] : ['이렇게 하세요', '이렇게 진행해'])
  return {
    kind,
    title,
    project,
    task,
    agent,
    summary,
    steps,
    commands: commandsIn(clean),
    success: sectionBody(clean, ['이렇게 나오면 성공']),
    sayToAside: kind === 'aside' ? `Aside에게 "${title} 해 줘"라고 말하면 돼요.` : '',
    prompt: clean.trim(),
    gateId: clean.match(GATE_ID)?.[1] ?? '',
    fileName,
    updatedAt,
  }
}

/** Lines inside the guide's code block, without the placeholder comment. */
function commandsIn(text: string): string[] {
  const lines = sectionLines(text, ['붙여 넣을 명령'])
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inside = !inside
      continue
    }
    const trimmed = line.trim()
    if (inside && trimmed && !trimmed.startsWith('#')) out.push(trimmed)
  }
  return out
}

/** The useful line from a RESULT.md, or empty. */
export function resultNote(text: string): string {
  const clean = text.replace(/^\uFEFF/, '')
  const done = clean.match(/한 것:\s*(.+)/)
  if (done?.[1] && !/^\(.*\)$/.test(done[1].trim())) return done[1].trim()
  const result = clean.match(/결과:\s*(.+)/)
  if (result?.[1] && result[1].trim() !== '없음' && !/^\(.*\)$/.test(result[1].trim())) return result[1].trim()
  const reported = sectionLines(clean, [RESULT_HEADING]).map((line) => line.trim()).find((line) => line && !/^\(.*\)$/.test(line))
  return reported ?? ''
}

/** One line for the top of the screen. */
export function workHeadline(aside: number, founder: number): string {
  const total = aside + founder
  if (!total) return '지금 하실 일은 없어요. 새 일이 생기면 여기에 보여요.'
  return `지금 할 일 ${total}개. Aside에게 말할 것 ${aside}개, 직접 하실 일 ${founder}개.`
}

function firstHeading(text: string): string {
  const line = text.split(/\r?\n/).find((item) => item.trim().startsWith('# '))
  return line ? line.trim().replace(/^#\s+/, '') : ''
}

function cleanTitle(title: string): string {
  return title.replace(/^#\s+/, '').replace(ASIDE_PREFIX, '').trim() || '제목 없는 일'
}

function sectionLines(text: string, headings: string[]): string[] {
  const lines = text.replace(/\r/g, '').split('\n')
  for (const heading of headings) {
    const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
    if (start < 0) continue
    const body: string[] = []
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith('## ') || line.startsWith('<details')) break
      body.push(line)
    }
    if (body.some((line) => line.trim())) return body
  }
  return []
}

function sectionBody(text: string, headings: string[]): string {
  return sectionLines(text, headings).map((line) => line.trim()).filter((line) => line && !line.startsWith('(')).join(' ')
}

function stepsIn(text: string, headings: string[]): string[] {
  return sectionLines(text, headings).map((line) => line.match(/^\d+\.\s+(.+)/)?.[1]?.trim() ?? '').filter(Boolean)
}

function firstParagraph(text: string): string {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const body: string[] = []
  let seenTitle = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!seenTitle) {
      if (line.startsWith('# ')) seenTitle = true
      continue
    }
    if (!line) {
      if (body.length) break
      continue
    }
    if (line.startsWith('#') || line.startsWith('<')) break
    if (AGENT_LINE.test(line) || line.startsWith('프로젝트:')) continue
    body.push(line)
  }
  return body.join(' ')
}
