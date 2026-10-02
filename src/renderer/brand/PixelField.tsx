import { useEffect, useRef } from 'react'
import { DEFAULT_PIXEL_FIELD, LIME_THRESHOLD, PixelFieldEngine, introShape } from './pixel-field-engine'

const PAPER = '242, 241, 234'
const LIME = '216, 255, 79'

/** Rest alpha of the static dot layer. Low on purpose: the texture must never fight the text. */
const BASE_ALPHA = 0.085

interface PixelFieldProps {
  /** Extra class names for positioning. The default `.pixel-field` fills its parent. */
  className?: string
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * JU pixel field: a dot grid under the app that reacts to the pointer like a terminal
 * reacting to the cursor. Cells near the pointer brighten and the nearest few turn lime;
 * now and then a signal sweeps a row. On mount the grid plays APPEAR → ASSEMBLE → RESOLVE.
 *
 * Pointer events pass straight through (`pointer-events: none`); we listen on `window`.
 * With `prefers-reduced-motion` the field is a still dot texture and no frame loop runs.
 *
 * 마우스를 가져다 대면 그 주변 픽셀이 밝아지고, 가장 가까운 몇 개만 라임으로 켜집니다.
 */
export function PixelField({ className = '' }: PixelFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    const engine = new PixelFieldEngine()
    const spacing = DEFAULT_PIXEL_FIELD.spacing
    let still = reducedMotion()
    let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    let width = 0
    let height = 0
    let raf = 0
    let base: HTMLCanvasElement | null = null
    let introDone = still

    function paintBase(alpha: number, jitter: number) {
      if (!base) base = document.createElement('canvas')
      base.width = Math.max(1, Math.floor(width * dpr))
      base.height = Math.max(1, Math.floor(height * dpr))
      const bctx = base.getContext('2d')
      if (!bctx) return
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      bctx.clearRect(0, 0, width, height)
      bctx.fillStyle = `rgba(${PAPER}, ${BASE_ALPHA * alpha})`
      const size = 1.6
      for (let row = 0; row < engine.rows; row += 1) {
        for (let col = 0; col < engine.cols; col += 1) {
          // Deterministic per-cell jitter so ASSEMBLE looks like dots gathering, not noise.
          const seed = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453
          const fx = seed - Math.floor(seed)
          const fy = (seed * 1.7) - Math.floor(seed * 1.7)
          const x = col * spacing + (fx - 0.5) * 2 * jitter
          const y = row * spacing + (fy - 0.5) * 2 * jitter
          bctx.fillRect(x - size / 2, y - size / 2, size, size)
        }
      }
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      canvas!.width = Math.floor(width * dpr)
      canvas!.height = Math.floor(height * dpr)
      context!.setTransform(dpr, 0, 0, dpr, 0, 0)
      engine.resize(width, height)
      paintBase(1, 0)
      if (still) {
        context!.clearRect(0, 0, width, height)
        if (base) context!.drawImage(base, 0, 0, width, height)
      }
    }

    function frame() {
      raf = 0
      if (document.hidden) return
      context!.clearRect(0, 0, width, height)

      if (!introDone) {
        const shape = introShape(engine.introProgress, spacing)
        paintBase(shape.alpha, shape.jitter)
        if (!engine.introducing) {
          introDone = true
          paintBase(1, 0)
        }
      }
      if (base) context!.drawImage(base, 0, 0, width, height)

      const cells = engine.step()
      for (const cell of cells) {
        const lime = cell.energy >= LIME_THRESHOLD
        const alpha = lime ? 0.55 + (cell.energy - LIME_THRESHOLD) * 1.6 : 0.1 + cell.energy * 0.5
        const size = 1.6 + cell.energy * 2.6
        context!.fillStyle = `rgba(${lime ? LIME : PAPER}, ${Math.min(1, alpha)})`
        const x = cell.col * spacing - size / 2
        const y = cell.row * spacing - size / 2
        context!.fillRect(x, y, size, size)
      }

      const idle = cells.length === 0 && engine.packetCount === 0 && introDone
      if (!idle) schedule()
    }

    function schedule() {
      if (!raf && !still) raf = window.requestAnimationFrame(frame)
    }

    function onMove(event: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      engine.setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      schedule()
    }

    function onLeave(event: MouseEvent) {
      // `mouseout` bubbles between elements; only a null relatedTarget means the window was left.
      if (event.relatedTarget) return
      engine.setPointer(null)
      schedule()
    }

    function onVisibility() {
      if (!document.hidden) schedule()
    }

    // When the loop is asleep (no pointer, nothing lit), send a sweep every few seconds
    // so the field keeps a faint pulse like a terminal cursor.
    const heartbeat = window.setInterval(() => {
      if (still || document.hidden) return
      if (!raf && Math.random() < 0.3 && engine.spawnPacket()) schedule()
    }, 1200)

    let media: MediaQueryList | null = null
    const onMotionChange = () => {
      still = reducedMotion()
      if (still) {
        if (raf) window.cancelAnimationFrame(raf)
        raf = 0
        introDone = true
        resize()
      } else {
        schedule()
      }
    }
    try {
      media = window.matchMedia('(prefers-reduced-motion: reduce)')
      media.addEventListener('change', onMotionChange)
    } catch {
      media = null
    }

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { resize(); schedule() }) : null
    observer?.observe(canvas)
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mouseout', onLeave)
    document.addEventListener('visibilitychange', onVisibility)

    resize()
    schedule()

    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      window.clearInterval(heartbeat)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      media?.removeEventListener('change', onMotionChange)
    }
  }, [])

  return <canvas ref={canvasRef} className={`pixel-field ${className}`} aria-hidden="true" />
}
