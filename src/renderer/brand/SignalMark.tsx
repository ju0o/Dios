import { useEffect, useState } from 'react'

/**
 * DIOS product mark — JU Signal Dot grammar + the DIOS motif.
 *
 * Parent grammar: a dot-matrix letterform with exactly one lime signal node.
 * DIOS motif: the "D" bowl holds three stacked rows (skills filed in one place),
 * and the signal node sits where a new skill slots in. Other JU products use the
 * same dots but a different motif (JuQode → bracket, JuTell → diff, …).
 *
 * 7×7 매트릭스 "D" + 안쪽 3단 선반(스킬 정리) + 라임 신호점 1개.
 * Founder가 2026-10-02에 이 마크를 승인했습니다 (HG-20261002-2d12fa).
 */
const GRID = 7

/** 1 = paper dot, 2 = shelf dot (dimmer), 3 = the lime signal node, 0 = empty. */
const DIOS_MATRIX: number[][] = [
  [0, 1, 1, 1, 1, 0, 0],
  [0, 1, 0, 0, 0, 1, 0],
  [0, 1, 0, 2, 2, 0, 1],
  [0, 1, 0, 3, 2, 0, 1],
  [0, 1, 0, 2, 2, 0, 1],
  [0, 1, 0, 0, 0, 1, 0],
  [0, 1, 1, 1, 1, 0, 0],
]

interface SignalMarkProps {
  /** Rendered size in CSS pixels. Defaults to 34. */
  size?: number
  /** Replays APPEAR → ASSEMBLE → RESOLVE when the pointer enters. Defaults to true. */
  reactive?: boolean
  /** Optional accessible label. The mark is decorative when omitted. */
  title?: string
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * The DIOS mark as inline SVG. Dots assemble in reading order and the signal node
 * resolves last. Hovering replays the sequence; reduced-motion shows the final frame.
 */
export function SignalMark({ size = 34, reactive = true, title }: SignalMarkProps) {
  const [run, setRun] = useState(0)
  const [still, setStill] = useState(() => reducedMotion())

  useEffect(() => {
    let media: MediaQueryList | null = null
    try {
      media = window.matchMedia('(prefers-reduced-motion: reduce)')
    } catch {
      return
    }
    const onChange = () => setStill(media!.matches)
    media.addEventListener('change', onChange)
    return () => media?.removeEventListener('change', onChange)
  }, [])

  const cell = 100 / GRID
  const dots: Array<{ x: number; y: number; kind: number; order: number }> = []
  let order = 0
  DIOS_MATRIX.forEach((row, y) => {
    row.forEach((kind, x) => {
      if (!kind) return
      dots.push({ x, y, kind, order })
      order += 1
    })
  })

  return (
    <svg
      key={run}
      className={`signal-mark ${still ? 'is-still' : ''}`}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      onMouseEnter={reactive && !still ? () => setRun((n) => n + 1) : undefined}
    >
      {dots.map((dot) => {
        const size = dot.kind === 3 ? cell * 0.78 : dot.kind === 2 ? cell * 0.5 : cell * 0.62
        const offset = (cell - size) / 2
        return (
          <rect
            key={`${dot.x}-${dot.y}`}
            className={dot.kind === 3 ? 'signal-mark-node' : dot.kind === 2 ? 'signal-mark-shelf' : 'signal-mark-dot'}
            x={dot.x * cell + offset}
            y={dot.y * cell + offset}
            width={size}
            height={size}
            rx={dot.kind === 3 ? size / 2 : 1.5}
            style={{ animationDelay: `${dot.kind === 3 ? 560 : 40 + dot.order * 18}ms` }}
          />
        )
      })}
    </svg>
  )
}
