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
