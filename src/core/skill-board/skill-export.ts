import fs from 'fs'
import path from 'path'
import type { SkillPack } from './library'

/** One skill, ready to drop on the desktop for the Founder or for ChatGPT. */
export interface ExportSkill {
  name: string
  summary: string
  /** Saved Korean sentence. Empty when this computer has no translation yet. */
  korean: string
  agentNames: string[]
  text: string
}

export interface ExportWrite {
  count: number
}

/** Desktop folder for the skill files the Founder picked. */
export const COPY_FOLDER = 'DIOS-스킬'

/** Desktop folder of notes the Founder can hand to ChatGPT. DIOS itself does not call a paid model. */
export const REVIEW_FOLDER = 'DIOS-스킬-점검'

const ASK_FILE = '00-ChatGPT에게-물어보기.md'
const TEXT_LIMIT = 80_000

/** Plain result line for a desktop copy. The folder path stays out of this sentence. */
export function copyMessage(count: number, skipped: number): string {
  if (!count) return '저장할 스킬을 먼저 골라 주세요.'
  const extra = skipped ? ` 글을 읽지 못한 ${skipped}개는 빼 두었어요.` : ''
  return `바탕화면에 스킬 ${count}개를 저장했어요. 폴더 이름은 ${COPY_FOLDER}이에요.${extra}`
}

/** Plain result line for the review pack. No charge happens inside DIOS. */
export function reviewMessage(count: number, unlinked: number): string {
  if (!count) return '에이전트에 붙은 스킬이 없어요. 붙인 다음 다시 눌러 주세요.'
  const extra = unlinked ? ` 안 붙은 스킬 ${unlinked}개는 빼 두었어요.` : ''
  return `바탕화면에 붙은 스킬 ${count}개의 점검 글을 만들었어요. 폴더 이름은 ${REVIEW_FOLDER}이에요. 그 안의 첫 글을 ChatGPT에 넣으면 돼요.${extra}`
}

/** Markdown files: one instruction sheet, then one file per linked skill. */
export function reviewBundle(skills: ExportSkill[]): { fileName: string; text: string }[] {
  const ordered = [...skills].sort((left, right) => left.name.localeCompare(right.name))
  const width = String(ordered.length).length > 2 ? String(ordered.length).length : 2
  const files = ordered.map((skill, index) => ({
    fileName: `${String(index + 1).padStart(width, '0')}-${skill.name}.md`,
    text: skillNote(skill),
  }))
  return [{ fileName: ASK_FILE, text: askNote(ordered, files.map((file) => file.fileName)) }, ...files]
}

/** Write picked skill folders. Existing copies of those same skills are replaced. */
export function writeSkillCopies(dir: string, packs: SkillPack[]): ExportWrite {
  fs.mkdirSync(dir, { recursive: true })
  let count = 0
  for (const pack of packs) {
    if (!pack.files.some((file) => file.path === 'SKILL.md')) continue
    const root = path.join(dir, pack.name)
    fs.rmSync(root, { recursive: true, force: true })
    fs.mkdirSync(root, { recursive: true })
    let wrote = false
    for (const file of pack.files) {
      const dest = safeJoin(root, file.path)
      if (!dest) continue
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, file.text)
      wrote = true
    }
    if (wrote) count += 1
  }
  return { count }
}

/** Replace this folder's review notes. Other folders on the desktop stay. */
export function writeReviewBundle(dir: string, skills: ExportSkill[]): ExportWrite {
  fs.mkdirSync(dir, { recursive: true })
  for (const name of fs.readdirSync(dir)) {
    if (/^\d+-.*\.md$/.test(name)) fs.rmSync(path.join(dir, name), { force: true })
  }
  const files = reviewBundle(skills)
  for (const file of files) fs.writeFileSync(path.join(dir, file.fileName), file.text)
  return { count: skills.length }
}

function askNote(skills: ExportSkill[], fileNames: string[]): string {
  const lines = skills.map((skill, index) => `- ${fileNames[index]} — ${skill.name} — ${skill.agentNames.join(', ')}`)
  return [
    '# ChatGPT에게 물어보세요',
    '',
    '이 폴더는 지금 에이전트에 붙어 있는 스킬을 모아 둔 거예요.',
    'DIOS 안에서는 유료 AI를 부르지 않아요. 비용은 ChatGPT에서만 나가요.',
    '',
    '## 이렇게 하세요',
    '',
    '1. ChatGPT를 여세요.',
    '2. 이 폴더의 글들을 넣으세요. 이 글과, 번호가 붙은 스킬 글이에요.',
    '3. 아래 문장을 그대로 붙여 넣으세요.',
    '',
    '## 붙여 넣을 문장',
    '',
    '첨부한 스킬 글을 읽어 주세요. 각 글 위에 어느 에이전트에 붙어 있는지가 적혀 있어요.',
    '고친 글을 새로 쓰지 말고, 개선할 점만 한글로 적어 주세요.',
    '',
    '- 하는 일이 한 문장으로 분명한지',
    '- 순서가 빠지거나 겹치는지',
    '- 붙은 에이전트에 맞는 일인지',
    '- 지우기, 결제, 공개처럼 사람이 직접 해야 하는 지시가 숨어 있는지',
    '',
    '스킬마다 고칠 점을 세 줄 안으로 적어 주세요.',
    '',
    '## 들어 있는 스킬',
    '',
    ...lines,
    '',
  ].join('\n')
}

function skillNote(skill: ExportSkill): string {
  const text = skill.text.length > TEXT_LIMIT
    ? `${skill.text.slice(0, TEXT_LIMIT)}\n\n(글이 길어서 여기서 잘랐어요.)\n`
    : skill.text
  const lines = [
    `# ${skill.name}`,
    '',
    `붙은 에이전트: ${skill.agentNames.join(', ')}`,
    '',
  ]
  if (skill.summary) lines.push(`하는 일: ${skill.summary}`, '')
  if (skill.korean) lines.push(`한글 한 줄: ${skill.korean}`, '')
  lines.push('아래는 그 스킬의 글이에요.', '', '---', '', text.endsWith('\n') ? text : `${text}\n`)
  return lines.join('\n')
}

function safeJoin(root: string, rel: string): string | null {
  if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.split('/').some((part) => !part || part === '..')) return null
  const dest = path.resolve(root, ...rel.split('/'))
  const base = path.resolve(root)
  if (dest !== base && !dest.startsWith(`${base}${path.sep}`)) return null
  return dest
}
