import { presentProjects, projectLabel, projectsFromPortfolio, projectsUsingSkill } from '../src/core/skill-board/project-skills'

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
})
