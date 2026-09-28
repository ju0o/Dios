/** Work lanes Agent Relay stores, in the order the Founder reads them. */
const LANES: Array<[string, string]> = [
  ['pm', '계획'],
  ['worker', '만들기'],
  ['qa', '검사'],
]

/** Product names the Founder already uses. Anything else is spaced out from its id. */
const PRODUCT_LABELS: Record<string, string> = {
  'agent-relay': 'Agent Relay',
  juactl: 'actl',
  juplan: 'JuPlan',
  juceipt: 'JuCeipt',
  jucontroler: 'JuControler',
  'jucontroler-app': 'JuControler 앱',
  'juceipt-planning': 'JuCeipt 기획',
  jutell: 'JuTell',
  juai: 'JuAI',
  'ai-agent-marketplace': '에이전트 마켓',
  juradar: 'JuRadar',
}

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/

/** One skill on one project, and which lanes use it. */
export interface ProjectSkillUse {
  name: string
  /** Korean lane names: 계획, 만들기, 검사. */
  lanes: string[]
}

/** One project and the skills Agent Relay attached to it. */
export interface ProjectSkills {
  id: string
  label: string
  skills: ProjectSkillUse[]
}

/** What the portfolio file stores, before names are turned into Korean. */
export interface RawProjectSkills {
  id: string
  lanes: Record<string, string[]>
}

/** The Founder's name for a known product folder, or undefined for anything else. */
export function knownProjectLabel(id: string): string | undefined {
  return PRODUCT_LABELS[id.toLowerCase()]
}

/** A short name for a project id. Known products keep their real names. */
export function projectLabel(id: string): string {
  if (PRODUCT_LABELS[id]) return PRODUCT_LABELS[id]
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Projects that have at least one skill, in name order. */
export function projectsFromPortfolio(raw: unknown): RawProjectSkills[] {
  const projects = (raw as { projects?: unknown })?.projects
  if (!Array.isArray(projects)) return []
  const out: RawProjectSkills[] = []
  for (const project of projects) {
    if (!project || typeof project !== 'object') continue
    const id = String((project as { id?: unknown }).id ?? '')
    if (!SAFE_NAME.test(id)) continue
    const skills = (project as { skills?: unknown }).skills
    if (!skills || typeof skills !== 'object') continue
    const lanes: Record<string, string[]> = {}
    for (const [lane] of LANES) {
      const list = (skills as Record<string, unknown>)[lane]
      if (!Array.isArray(list)) continue
      const names = [...new Set(list.filter((item): item is string => typeof item === 'string' && SAFE_NAME.test(item)))]
      if (names.length) lanes[lane] = names.sort()
    }
    if (Object.keys(lanes).length) out.push({ id, lanes })
  }
  return out
}

/** Korean labels for the screen. Projects with no skills are already gone. */
export function presentProjects(raw: RawProjectSkills[]): ProjectSkills[] {
  return raw
    .map((project) => {
      const byName = new Map<string, string[]>()
      for (const [lane, label] of LANES) {
        for (const name of project.lanes[lane] ?? []) {
          const lanes = byName.get(name) ?? []
          lanes.push(label)
          byName.set(name, lanes)
        }
      }
      const skills = [...byName.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, lanes]) => ({ name, lanes }))
      return { id: project.id, label: projectLabel(project.id), skills }
    })
    .filter((project) => project.skills.length > 0)
    .sort((left, right) => left.label.localeCompare(right.label, 'ko', { sensitivity: 'base' }))
}

/** Project names that use this skill, for the skill detail line. */
export function projectsUsingSkill(projects: ProjectSkills[], skillName: string): string[] {
  return projects.filter((project) => project.skills.some((skill) => skill.name === skillName)).map((project) => project.label)
}

/** One skill on the project home, on or remembered as off. */
export interface SkillSwitch {
  name: string
  /** Korean lane names while it is on. Empty when it is off. */
  lanes: string[]
  on: boolean
  /** One Korean sentence, when one is already saved. */
  korean: string
}

/** The Agent Relay project whose id or display name matches this project, even if every skill is off. */
export function matchPortfolioId(portfolio: { projects?: Array<{ id?: unknown }> }, projectName: string): string {
  const trimmed = projectName.trim()
  if (!trimmed) return ''
  const projects = (portfolio.projects ?? []).filter((item): item is { id: string } => typeof item?.id === 'string' && SAFE_NAME.test(item.id))
  const slug = trimmed.toLowerCase().replace(/\s+/g, '-')
  const found = projects.find((project) => project.id === slug)
    ?? projects.find((project) => projectLabel(project.id).toLowerCase() === trimmed.toLowerCase())
  return found?.id ?? ''
}

/** The Agent Relay project whose id or display name matches this project. */
export function matchRelayProject(projects: RawProjectSkills[], projectName: string): RawProjectSkills | null {
  const trimmed = projectName.trim()
  if (!trimmed) return null
  const slug = trimmed.toLowerCase().replace(/\s+/g, '-')
  return projects.find((project) => project.id === slug)
    ?? projects.find((project) => projectLabel(project.id).toLowerCase() === trimmed.toLowerCase())
    ?? null
}

/** Skills that are on, plus ones the Founder turned off so they can come back. */
export function switchesFor(project: RawProjectSkills | null, off: string[], korean: Record<string, string> = {}): SkillSwitch[] {
  const shown = project ? presentProjects([project])[0] : undefined
  const onNames = new Set((shown?.skills ?? []).map((skill) => skill.name))
  const rows: SkillSwitch[] = (shown?.skills ?? []).map((skill) => ({
    name: skill.name,
    lanes: skill.lanes,
    on: true,
    korean: korean[skill.name] || '',
  }))
  for (const name of off) {
    if (!SAFE_NAME.test(name) || onNames.has(name)) continue
    rows.push({ name, lanes: [], on: false, korean: korean[name] || '' })
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Add a skill to one project's three lanes, or take it off every lane of that project.
 * Other projects and other fields stay as they are. Returns how many lane lists changed.
 */
export function applyProjectSkill(
  portfolio: { projects?: Array<{ id?: unknown; skills?: Record<string, unknown> }> },
  projectId: string,
  skillName: string,
  on: boolean,
): number {
  if (!SAFE_NAME.test(skillName)) return 0
  const project = (portfolio.projects ?? []).find((item) => item?.id === projectId)
  if (!project) return 0
  if (!project.skills || typeof project.skills !== 'object') project.skills = {}
  let touched = 0
  if (on) {
    for (const [lane] of LANES) {
      const names = stringList(project.skills[lane])
      if (!names || names.includes(skillName)) continue
      names.push(skillName)
      project.skills[lane] = names
      touched += 1
    }
    return touched
  }
  for (const lane of Object.keys(project.skills)) {
    const names = stringList(project.skills[lane])
    if (!names || !names.includes(skillName)) continue
    project.skills[lane] = names.filter((item) => item !== skillName)
    touched += 1
  }
  return touched
}

/** The line under the switch, right after it changes. */
export function switchMessage(label: string, on: boolean, touched: number): string {
  if (on) return touched ? `${label}에 붙였어요.` : `${label}에 이미 붙어 있어요.`
  return touched ? `${label}에서 뺐어요. 스킬 글은 그대로예요.` : `${label}에는 이미 없어요.`
}

function stringList(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
  return value.slice()
}
