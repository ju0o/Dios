import { differentPlaces, driftCount, driftLine } from '../src/core/skill-board/drift'

describe('skill drift', () => {
  const rows = [
    { cells: { local: 'base', asus: 'same', desktop: 'different' } },
    { cells: { local: 'base', asus: 'same', desktop: 'same' } },
    { cells: { local: 'base', asus: 'missing', desktop: 'missing' } },
  ]

  it('counts skills that differ and ignores ones that are merely missing', () => {
    expect(driftCount(rows, 'local')).toBe(1)
    expect(differentPlaces(rows[0].cells, 'local')).toEqual(['desktop'])
  })

  it('says how many differ, in one Korean line', () => {
    expect(driftLine(0)).toBe('')
    expect(driftLine(3)).toContain('3개')
    expect(driftLine(3)).not.toMatch(/[A-Za-z]{4,}/)
  })
})