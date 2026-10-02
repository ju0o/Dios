/**
 * Grid model behind the JU pixel field. No DOM here, so the behaviour is unit-testable.
 *
 * Each cell carries an `energy` 0..1. The pointer raises energy on nearby cells, idle
 * "signal packets" travel along rows/columns like a terminal cursor sweep, and
 * everything eases back to rest. The renderer only draws cells with energy > 0,
 * on top of a static dot layer, so a 6,000-cell grid stays cheap.
 *
 * 포인터 주변 셀만 밝아지고, 가끔 신호 하나가 줄을 따라 지나갑니다. 전부 서서히 원래대로 돌아갑니다.
 */

export interface PixelFieldOptions {
  /** Distance between cell centres in CSS pixels. */
  spacing: number
  /** Radius of the pointer influence in CSS pixels. */
  pointerRadius: number
  /** How fast energy chases its target per frame (0..1). */
  ease: number
  /** How fast energy decays when nothing feeds it per frame (0..1). */
  decay: number
  /** Average frames between idle signal packets. 0 turns packets off. */
  packetEvery: number
  /** Cells a packet advances per frame. */
  packetSpeed: number
  /** Duration of the mount sequence in frames (APPEAR → ASSEMBLE → RESOLVE). */
  introFrames: number
}

export const DEFAULT_PIXEL_FIELD: PixelFieldOptions = {
  spacing: 14,
  pointerRadius: 120,
  ease: 0.22,
  decay: 0.08,
  packetEvery: 150,
  packetSpeed: 1.6,
  introFrames: 54,
}

export interface Packet {
  /** 'row' travels left→right along row `line`; 'col' travels top→bottom along column `line`. */
  axis: 'row' | 'col'
  line: number
  /** Position along the axis in cells (fractional). */
  at: number
}

export interface ActiveCell {
  col: number
  row: number
  /** 0..1 — brightness and size driver. */
  energy: number
}

export class PixelFieldEngine {
  readonly options: PixelFieldOptions
  cols = 0
  rows = 0
  private energy = new Float32Array(0)
  private target = new Float32Array(0)
  private active = new Set<number>()
  private packets: Packet[] = []
  private frame = 0
  private pointer: { x: number; y: number } | null = null
  private random: () => number

  constructor(options: Partial<PixelFieldOptions> = {}, random: () => number = Math.random) {
    this.options = { ...DEFAULT_PIXEL_FIELD, ...options }
    this.random = random
  }

  /** Fit the grid to a viewport. Keeps nothing from the previous size. */
  resize(width: number, height: number): void {
    const { spacing } = this.options
    this.cols = Math.max(1, Math.ceil(width / spacing) + 1)
    this.rows = Math.max(1, Math.ceil(height / spacing) + 1)
    this.energy = new Float32Array(this.cols * this.rows)
    this.target = new Float32Array(this.cols * this.rows)
    this.active.clear()
    this.packets = []
  }

  /** Pointer in canvas CSS pixels, or null when it left the window. */
  setPointer(point: { x: number; y: number } | null): void {
    this.pointer = point
  }

  /** Start one idle signal sweep along a random row or column. At most two travel at once. */
  spawnPacket(): boolean {
    if (this.packets.length >= 2 || this.cols === 0) return false
    const axis: Packet['axis'] = this.random() < 0.6 ? 'row' : 'col'
    const line = Math.floor(this.random() * (axis === 'row' ? this.rows : this.cols))
    this.packets.push({ axis, line, at: -2 })
    return true
  }

  /** Number of sweeps currently travelling. */
  get packetCount(): number {
    return this.packets.length
  }

  /** True while the mount sequence is still playing. */
  get introducing(): boolean {
    return this.frame < this.options.introFrames
  }

  /** Progress of the mount sequence 0..1. */
  get introProgress(): number {
    return Math.min(1, this.frame / Math.max(1, this.options.introFrames))
  }

  /** Advance one frame. Returns the cells the renderer should draw on top of the base layer. */
  step(): ActiveCell[] {
    this.frame += 1
    const { spacing, pointerRadius, ease, decay, packetEvery, packetSpeed } = this.options

    this.target.fill(0)

    if (this.pointer) {
      const cx = this.pointer.x / spacing
      const cy = this.pointer.y / spacing
      const reach = pointerRadius / spacing
      const minCol = Math.max(0, Math.floor(cx - reach))
      const maxCol = Math.min(this.cols - 1, Math.ceil(cx + reach))
      const minRow = Math.max(0, Math.floor(cy - reach))
      const maxRow = Math.min(this.rows - 1, Math.ceil(cy + reach))
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const dx = col - cx
          const dy = row - cy
          const distance = Math.sqrt(dx * dx + dy * dy) / reach
          if (distance >= 1) continue
          // Smooth falloff; the very centre reaches 1 so a few cells turn lime.
          const strength = (1 - distance) * (1 - distance)
          const index = row * this.cols + col
          if (strength > this.target[index]) this.target[index] = strength
          this.active.add(index)
        }
      }
    }

    if (packetEvery > 0 && !this.introducing && this.random() < 1 / packetEvery) this.spawnPacket()

    const survivors: Packet[] = []
    for (const packet of this.packets) {
      packet.at += packetSpeed
      const length = packet.axis === 'row' ? this.cols : this.rows
      const head = Math.floor(packet.at)
      // A short trail behind the head, fading out — like a cursor sweep.
      for (let back = 0; back < 6; back += 1) {
        const position = head - back
        if (position < 0 || position >= length) continue
        const index = packet.axis === 'row' ? packet.line * this.cols + position : position * this.cols + packet.line
        const strength = back === 0 ? 0.95 : 0.55 * (1 - back / 6)
        if (strength > this.target[index]) this.target[index] = strength
        this.active.add(index)
      }
      if (packet.at < length + 6) survivors.push(packet)
    }
    this.packets = survivors

    const out: ActiveCell[] = []
    for (const index of this.active) {
      const goal = this.target[index]
      const current = this.energy[index]
      const next = goal > current ? current + (goal - current) * ease : current - current * decay
      if (next < 0.012) {
        this.energy[index] = 0
        this.active.delete(index)
        continue
      }
      this.energy[index] = next
      out.push({ col: index % this.cols, row: Math.floor(index / this.cols), energy: next })
    }
    return out
  }
}

/**
 * Mount sequence shape for the base layer.
 * APPEAR: dots fade in; ASSEMBLE: jitter collapses onto the grid; RESOLVE: settle.
 * Returns alpha multiplier and jitter amplitude (in px) for progress 0..1.
 */
export function introShape(progress: number, spacing: number): { alpha: number; jitter: number } {
  const p = Math.min(1, Math.max(0, progress))
  const appear = Math.min(1, p / 0.45)
  const assemble = p < 0.3 ? 1 : Math.max(0, 1 - (p - 0.3) / 0.6)
  const eased = 1 - (1 - assemble) * (1 - assemble)
  return { alpha: appear, jitter: eased * spacing * 0.42 }
}

/** Energy at which a cell turns lime instead of brighter paper. Lime stays a signal, not a fill. */
export const LIME_THRESHOLD = 0.72
