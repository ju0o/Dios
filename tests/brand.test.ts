import { describe, expect, it } from 'vitest'
import { LIME_THRESHOLD, PixelFieldEngine, introShape } from '../src/renderer/brand/pixel-field-engine'
import { WORK_HOLD_LINE, firstView, isWorkListOn, setWorkListOn } from '../src/core/founder-work/work-hold'

function memoryStore() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

describe('pixel field engine', () => {
  it('lights only the cells around the pointer and the centre crosses the lime line', () => {
    const engine = new PixelFieldEngine({ spacing: 10, pointerRadius: 30, introFrames: 0, packetEvery: 0 }, () => 1)
    engine.resize(200, 100)
    expect(engine.cols).toBe(21)
    expect(engine.rows).toBe(11)
    engine.setPointer({ x: 100, y: 50 })
    let cells = engine.step()
    for (let i = 0; i < 30; i += 1) cells = engine.step()
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.length).toBeLessThan(40)
    const centre = cells.find((cell) => cell.col === 10 && cell.row === 5)
    expect(centre).toBeDefined()
    expect(centre!.energy).toBeGreaterThan(LIME_THRESHOLD)
    expect(cells.filter((cell) => cell.energy >= LIME_THRESHOLD).length).toBeLessThanOrEqual(5)
    for (const cell of cells) {
      expect(Math.abs(cell.col - 10) <= 3 && Math.abs(cell.row - 5) <= 3).toBe(true)
    }
  })

  it('fades back to rest after the pointer leaves', () => {
    const engine = new PixelFieldEngine({ spacing: 10, pointerRadius: 30, introFrames: 0, packetEvery: 0 }, () => 1)
    engine.resize(100, 100)
    engine.setPointer({ x: 50, y: 50 })
    for (let i = 0; i < 10; i += 1) engine.step()
    engine.setPointer(null)
    let cells = engine.step()
    for (let i = 0; i < 120 && cells.length; i += 1) cells = engine.step()
    expect(cells).toEqual([])
  })

  it('sends a sweep along one row that travels and then ends', () => {
    const engine = new PixelFieldEngine({ spacing: 10, pointerRadius: 30, introFrames: 0, packetEvery: 0, packetSpeed: 2 }, () => 0.1)
    engine.resize(100, 100)
    expect(engine.spawnPacket()).toBe(true)
    expect(engine.packetCount).toBe(1)
    const rows = new Set<number>()
    let steps = 0
    while (engine.packetCount > 0 && steps < 200) {
      for (const cell of engine.step()) rows.add(cell.row)
      steps += 1
    }
    expect(rows.size).toBe(1)
    expect(engine.packetCount).toBe(0)
    expect(steps).toBeLessThan(60)
  })

  it('plays APPEAR then ASSEMBLE then RESOLVE', () => {
    const start = introShape(0, 14)
    const middle = introShape(0.5, 14)
    const end = introShape(1, 14)
    expect(start.alpha).toBe(0)
    expect(start.jitter).toBeGreaterThan(end.jitter)
    expect(middle.alpha).toBe(1)
    expect(middle.jitter).toBeGreaterThan(0)
    expect(end).toEqual({ alpha: 1, jitter: 0 })
  })
})

describe('지금 할 일 hold', () => {
  it('is parked by default and opens on the skill board', () => {
    const store = memoryStore()
    expect(isWorkListOn(store)).toBe(false)
    expect(firstView(isWorkListOn(store))).toBe('skillBoard')
    expect(WORK_HOLD_LINE).toMatch(/[가-힣]/)
  })

  it('comes back when the Founder switches it on', () => {
    const store = memoryStore()
    setWorkListOn(store, true)
    expect(isWorkListOn(store)).toBe(true)
    expect(firstView(true)).toBe('now')
    setWorkListOn(store, false)
    expect(isWorkListOn(store)).toBe(false)
  })

  it('survives missing storage', () => {
    expect(isWorkListOn(null)).toBe(false)
    expect(() => setWorkListOn(null, true)).not.toThrow()
  })
})
