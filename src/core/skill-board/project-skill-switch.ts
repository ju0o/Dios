import fs from 'fs'
import path from 'path'
import { readLibrary } from '../skill-library/catalog'
import { PROJECT_FOLDER, projectFolderName, projectPackMessage, writeProjectBundle, type ExportSkill } from './skill-export'
import { blurbSentences } from './translation-store'
import {
  applyProjectSkill,
  matchPortfolioId,
  projectLabel,
  projectsFromPortfolio,
  switchMessage,
  switchesFor,
  type SkillSwitch,
} from './project-skills'

/** A shared-folder skill the project could still take. */
export interface SkillPick {
  name: string
  korean: string
  summary: string
}

/** Skills on one project, ready for the project home. */
export interface ProjectSkillList {
  /** True when an Agent Relay project matches this name. */
  matched: boolean
  label: string
  message: string
  skills: SkillSwitch[]
  /** Skills in the shared folder that this project does not use yet. */
  available: SkillPick[]
}

interface OffFile {
  version: 1
  projects: Record<string, string[]>
}

/** Same file Agent Relay reads. Other fields are written back unchanged. */
function portfolioPath(home: string): string {
  return path.join(home, '.local', 'share', 'AgentRelay', 'night-runtime', 'config', 'portfolio.json')
}

function offPath(home: string): string {
  return path.join(home, '.local', 'share', 'dios', 'project-skill-off.json')
}

function readOff(home: string): OffFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(offPath(home), 'utf8')) as OffFile
    if (parsed?.version === 1 && parsed.projects && typeof parsed.projects === 'object') return parsed
  } catch {
    // The first time a skill is turned off, the file starts empty.
  }
  return { version: 1, projects: {} }
}

function writeOff(home: string, file: OffFile): void {
  const dest = offPath(home)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.dios-tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`)
  fs.renameSync(tmp, dest)
}

function readPortfolio(home: string): { ok: true; portfolio: { projects?: Array<{ id?: unknown; skills?: Record<string, unknown> }> } } | { ok: false; message: string } {
  const file = portfolioPath(home)
  if (!fs.existsSync(file)) return { ok: false, message: '이 컴퓨터의 Agent Relay에는 아직 프로젝트 스킬이 없어요.' }
  try {
    return { ok: true, portfolio: JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch {
    return { ok: false, message: '프로젝트 스킬 기록을 읽지 못했어요.' }
  }
}

function writePortfolio(home: string, portfolio: unknown): void {
  const file = portfolioPath(home)
  const tmp = `${file}.dios-tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(portfolio, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

/** One Agent Relay project, for picking on the project home or a library card. */
export interface RelayProject {
  id: string
  label: string
  /** Skill names on any lane, sorted. */
  skills: string[]
}

/** Every project in this computer's Agent Relay, with or without skills. Empty when there is no Agent Relay. */
export function relayProjects(home: string): RelayProject[] {
  const loaded = readPortfolio(home)
  if (!loaded.ok) return []
  const withSkills = new Map(projectsFromPortfolio(loaded.portfolio).map((project) => [project.id, project]))
  const out: RelayProject[] = []
  for (const item of loaded.portfolio.projects ?? []) {
    const id = typeof item?.id === 'string' ? item.id : ''
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id) || out.some((row) => row.id === id)) continue
    const lanes = withSkills.get(id)?.lanes ?? {}
    const skills = [...new Set(Object.values(lanes).flat())].sort()
    out.push({ id, label: projectLabel(id), skills })
  }
  return out.sort((left, right) => left.label.localeCompare(right.label, 'ko', { sensitivity: 'base' }))
}

/** Shared-folder skills the project does not use yet, so the Founder can add one from the home screen. */
export function availableSkills(home: string, taken: SkillSwitch[], extraRoots: string[] = []): SkillPick[] {
  const used = new Set(taken.map((skill) => skill.name))
  const korean = blurbSentences(home)
  return readLibrary(home, extraRoots)
    .filter((skill) => skill.canonical && !used.has(skill.name))
    .map((skill) => ({ name: skill.name, korean: skill.korean || korean[skill.name] || '', summary: skill.summary }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Skills attached to the project with this name, including ones turned off here. */
export function listProjectSkills(home: string, projectName: string, extraRoots: string[] = []): ProjectSkillList {
  const loaded = readPortfolio(home)
  if (!loaded.ok) return { matched: false, label: '', message: loaded.message, skills: [], available: [] }
  const projectId = matchPortfolioId(loaded.portfolio, projectName)
  if (!projectId) {
    return {
      matched: false,
      label: '',
      message: '이 이름과 같은 프로젝트가 없어요. Agent Relay에 있는 프로젝트 이름과 같게 만들면 여기서 켜고 끌 수 있어요.',
      skills: [],
      available: [],
    }
  }
  const project = projectsFromPortfolio(loaded.portfolio).find((item) => item.id === projectId) ?? null
  const off = readOff(home).projects[projectId] ?? []
  const skills = switchesFor(project, off, blurbSentences(home))
  return {
    matched: true,
    label: projectLabel(projectId),
    message: '',
    skills,
    available: availableSkills(home, skills, extraRoots),
  }
}

/** Result of writing one project's skill notes onto the desktop. */
export interface ProjectPack {
  ok: boolean
  message: string
  /** Folder that was written. Empty when nothing was. Only for 원문 보기. */
  folder: string
}

/**
 * Write the skills that are on for this project onto the desktop, one note each plus a sheet for Aside.
 * The Founder hands that folder to Aside or ChatGPT; DIOS itself calls no paid model.
 */
export function saveProjectSkillPack(home: string, projectName: string, desktop: string, extraRoots: string[] = []): ProjectPack {
  const listed = listProjectSkills(home, projectName, extraRoots)
  if (!listed.matched) return { ok: false, message: listed.message || '이 이름과 같은 프로젝트가 없어요.', folder: '' }
  const on = listed.skills.filter((skill) => skill.on)
  if (!on.length) return { ok: false, message: projectPackMessage(listed.label, 0, 0), folder: '' }
  const library = new Map(readLibrary(home, extraRoots).map((skill) => [skill.name, skill]))
  const notes: ExportSkill[] = []
  let missing = 0
  for (const skill of on) {
    const text = skillText(home, skill.name, library.get(skill.name)?.homes.map((item) => item.path) ?? [])
    if (!text) {
      missing += 1
      continue
    }
    notes.push({
      name: skill.name,
      summary: library.get(skill.name)?.summary ?? '',
      korean: skill.korean,
      agentNames: [],
      lanes: skill.lanes,
      text,
    })
  }
  if (!notes.length) return { ok: false, message: `${listed.label}에 켜 둔 스킬 글을 하나도 찾지 못했어요. 스킬 라이브러리에서 그 스킬이 있는지 봐 주세요.`, folder: '' }
  const root = path.resolve(desktop, PROJECT_FOLDER)
  const folder = path.resolve(root, projectFolderName(listed.label))
  if (!folder.startsWith(`${root}${path.sep}`)) return { ok: false, message: '폴더 이름을 만들지 못했어요.', folder: '' }
  try {
    writeProjectBundle(folder, listed.label, notes)
    return { ok: true, message: projectPackMessage(listed.label, notes.length, missing), folder }
  } catch {
    return { ok: false, message: '바탕화면에 저장하지 못했어요. 다시 시도해 주세요.', folder: '' }
  }
}

/** SKILL.md from the shared folder first, then from any other copy this computer has. */
function skillText(home: string, name: string, otherDirs: string[]): string {
  const dirs = [path.join(home, '.agents', 'skills', name), ...otherDirs]
  for (const dir of dirs) {
    try {
      const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
      if (text.trim()) return text
    } catch {
      // Try the next copy.
    }
  }
  return ''
}

/**
 * Turn one skill on or off for one project.
 * Off keeps the skill file and remembers the name, so it can be turned on again from this screen.
 */
export function setProjectSkill(home: string, projectName: string, skillName: string, on: boolean, extraRoots: string[] = []): ProjectSkillList {
  const loaded = readPortfolio(home)
  if (!loaded.ok) return { matched: false, label: '', message: loaded.message, skills: [], available: [] }
  const projectId = matchPortfolioId(loaded.portfolio, projectName)
  if (!projectId) {
    return { matched: false, label: '', message: '이 이름과 같은 프로젝트가 없어요.', skills: [], available: [] }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(skillName)) {
    return { ...listProjectSkills(home, projectName, extraRoots), message: '스킬 이름이 이상해요.' }
  }
  const touched = applyProjectSkill(loaded.portfolio, projectId, skillName, on)
  if (touched > 0) writePortfolio(home, loaded.portfolio)
  const offFile = readOff(home)
  const current = new Set(offFile.projects[projectId] ?? [])
  if (on) current.delete(skillName)
  else current.add(skillName)
  offFile.projects[projectId] = [...current]
  writeOff(home, offFile)
  const label = projectLabel(projectId)
  const listed = listProjectSkills(home, projectName, extraRoots)
  return { ...listed, message: switchMessage(label, on, touched) }
}
