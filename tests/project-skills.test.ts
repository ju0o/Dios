import { applyProjectSkill, matchRelayProject, presentProjects, projectLabel, projectsFromPortfolio, projectsUsingSkill, switchesFor } from '../src/core/skill-board/project-skills'

const sample = {
  projects: [
    {
      id: 'juplan',
      skills: {
        pm: ['founder-ux', 'founder-gate-relay'],
        worker: ['founder-ux'],
        qa: ['not a name', 'founder-ux'],
      },
    },
    { id: 'juactl', skills: { pm: ['founder-ux'], extra: ['secret-skill'] } },
    { id: 'empty-one', skills: { pm: [] } },
    { id: 'nope' },
  ],
}

describe('project skills', () => {
  it('keeps known product names and spaces the rest', () => {
    expect(projectLabel('juplan')).toBe('JuPlan')
    expect(projectLabel('juactl')).toBe('actl')
    expect(projectLabel('my-tool')).toBe('My Tool')
  })

  it('groups a skill by the lanes that use it and drops empty projects', () => {
    const projects = presentProjects(projectsFromPortfolio(sample))
    expect(projects.map((project) => project.label)).toEqual(['actl', 'JuPlan'])
    const juplan = projects.find((project) => project.id === 'juplan')
    expect(juplan?.skills).toEqual([
      { name: 'founder-gate-relay', lanes: ['계획'] },
      { name: 'founder-ux', lanes: ['계획', '만들기', '검사'] },
    ])
    expect(projectsUsingSkill(projects, 'founder-ux')).toEqual(['actl', 'JuPlan'])
    expect(projectsUsingSkill(projects, 'missing')).toEqual([])
  })

  it('ignores a portfolio that is not a project list', () => {
    expect(projectsFromPortfolio(null)).toEqual([])
    expect(projectsFromPortfolio({ projects: 'nope' })).toEqual([])
  })

  it('matches a project by its id or its display name', () => {
    const raw = projectsFromPortfolio(sample)
    expect(matchRelayProject(raw, 'JuPlan')?.id).toBe('juplan')
    expect(matchRelayProject(raw, 'actl')?.id).toBe('juactl')
    expect(matchRelayProject(raw, '없는 이름')).toBeNull()
  })

  it('turns one project on and off without touching the others', () => {
    const portfolio = {
      title: '그대로',
      projects: [
        { id: 'juplan', title: 'JuPlan', skills: { pm: ['founder-ux'], worker: ['founder-ux'], qa: ['founder-ux'] } },
        { id: 'juactl', skills: { pm: ['founder-ux'] } },
      ],
    }
    expect(applyProjectSkill(portfolio, 'juplan', 'demo-skill', true)).toBe(3)
    expect(portfolio.projects[0].skills.pm).toEqual(['founder-ux', 'demo-skill'])
    expect(portfolio.projects[0].skills.qa).toEqual(['founder-ux', 'demo-skill'])
    expect(portfolio.projects[1].skills.pm).toEqual(['founder-ux'])
    expect(portfolio.title).toBe('그대로')
    expect(applyProjectSkill(portfolio, 'juplan', 'founder-ux', false)).toBe(3)
    expect(portfolio.projects[0].skills.pm).toEqual(['demo-skill'])
    expect(portfolio.projects[0].skills.qa).toEqual(['demo-skill'])
    expect(portfolio.projects[1].skills.pm).toEqual(['founder-ux'])
    const off = switchesFor(projectsFromPortfolio(portfolio).find((project) => project.id === 'juplan') ?? null, ['founder-ux'])
    expect(off.map((skill) => [skill.name, skill.on])).toEqual([['demo-skill', true], ['founder-ux', false]])
  })
})
