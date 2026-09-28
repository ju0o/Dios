import fs from 'fs'
import path from 'path'
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

/** Skills on one project, ready for the project home. */
export interface ProjectSkillList {
  /** True when an Agent Relay project matches this name. */
  matched: boolean
  label: string
  message: string
  skills: SkillSwitch[]
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

/** Skills attached to the project with this name, including ones turned off here. */
export function listProjectSkills(home: string, projectName: string): ProjectSkillList {
  const loaded = readPortfolio(home)
  if (!loaded.ok) return { matched: false, label: '', message: loaded.message, skills: [] }
  const projectId = matchPortfolioId(loaded.portfolio, projectName)
  if (!projectId) {
    return {
      matched: false,
      label: '',
      message: '이 이름과 같은 프로젝트가 없어요. Agent Relay에 있는 프로젝트 이름과 같게 만들면 여기서 켜고 끌 수 있어요.',
      skills: [],
    }
  }
  const project = projectsFromPortfolio(loaded.portfolio).find((item) => item.id === projectId) ?? null
  const off = readOff(home).projects[projectId] ?? []
  return {
    matched: true,
    label: projectLabel(projectId),
    message: '',
    skills: switchesFor(project, off, blurbSentences(home)),
  }
}

/**
 * Turn one skill on or off for one project.
 * Off keeps the skill file and remembers the name, so it can be turned on again from this screen.
 */
export function setProjectSkill(home: string, projectName: string, skillName: string, on: boolean): ProjectSkillList {
  const loaded = readPortfolio(home)
  if (!loaded.ok) return { matched: false, label: '', message: loaded.message, skills: [] }
  const projectId = matchPortfolioId(loaded.portfolio, projectName)
  if (!projectId) {
    return { matched: false, label: '', message: '이 이름과 같은 프로젝트가 없어요.', skills: [] }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(skillName)) {
    return { matched: true, label: projectLabel(projectId), message: '스킬 이름이 이상해요.', skills: listProjectSkills(home, projectName).skills }
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
  const listed = listProjectSkills(home, projectName)
  return { ...listed, message: switchMessage(label, on, touched) }
}
