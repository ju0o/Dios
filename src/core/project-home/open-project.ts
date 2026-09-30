/** Where the usage screen leaves the project name it wants the home screen to open. */
export const OPEN_PROJECT_KEY = 'dios.openProjectName'

/** Usage rows that stand for many folders, not one project. They get no link. */
const NOT_A_PROJECT = new Set(['홈 폴더', '여러 프로젝트 폴더'])

/** True when this usage row names one project the home screen could show. */
export function canOpenProject(name: string): boolean {
  return Boolean(name.trim()) && !NOT_A_PROJECT.has(name.trim())
}

/** The DIOS project whose name matches, ignoring case, spaces, and hyphens. '' when none does. */
export function projectIdForName(projects: Array<{ id: string; name: string }>, name: string): string {
  const wanted = fold(name)
  if (!wanted) return ''
  return projects.find((project) => fold(project.name) === wanted)?.id ?? ''
}

/** What the home screen says when it arrived from the usage screen. */
export function openProjectMessage(name: string, found: boolean, canMake: boolean): string {
  if (found) return `사용량에서 온 ${name} 홈이에요.`
  if (canMake) return `${name} 홈이 아직 없어요. 아래에서 만들면 스킬을 바로 켜고 끌 수 있어요.`
  return `${name} 홈이 아직 없어요. 위의 만들기에서 같은 이름으로 만들면 여기가 그 홈이 돼요.`
}

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}
