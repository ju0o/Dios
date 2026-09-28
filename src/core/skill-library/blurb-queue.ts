/** How long after the app opens before the first Korean sentence. */
export const BLURB_START_MS = 25_000
/** Quiet gap between sentences, so the computer stays usable. */
export const BLURB_GAP_MS = 15_000

export type BlurbPhase = 'idle' | 'working' | 'done' | 'paused' | 'stopped'

/** What the skill library shows while sentences are prepared. */
export interface BlurbProgress {
  phase: BlurbPhase
  done: number
  total: number
  /** Skill the latest sentence belongs to. */
  name: string
  korean: string
  message: string
}

export interface BlurbQueueDeps {
  /** Skill names that still have no Korean sentence. */
  listPending: () => string[] | Promise<string[]>
  translate: (name: string) => Promise<{ ok: boolean; message: string; korean: string }>
}

const EMPTY: BlurbProgress = { phase: 'idle', done: 0, total: 0, name: '', korean: '', message: '' }

/** Names that still need a sentence, in list order. */
export function pendingBlurbNames(skills: Array<{ name: string; korean: string }>): string[] {
  return skills.filter((skill) => !skill.korean).map((skill) => skill.name)
}

/** True when the translator is missing or still downloading, so retrying now will not help. */
export function blurbBlocked(message: string): boolean {
  return message.includes('Ollama') || message.includes('내려받고') || message.includes('번역 준비를 못')
}

/** One line for the skill library. Empty when nothing is happening. */
export function blurbStatusLine(progress: BlurbProgress): string {
  if (progress.phase === 'working') return `한글 설명을 미리 만들고 있어요 · ${progress.done}/${progress.total}`
  if (progress.phase === 'paused') return '한글 설명을 멈췄어요.'
  if (progress.phase === 'stopped') return progress.message || '한글 설명을 지금 만들지 못해요.'
  if (progress.phase === 'done') return progress.message || '한글 설명을 모두 만들어 뒀어요.'
  return ''
}

/**
 * Make one Korean sentence at a time for skills that do not have one yet.
 * A bad sentence is skipped until the next launch. A missing translator stops the run.
 */
export function createBlurbQueue(deps: BlurbQueueDeps, options?: { gapMs?: number }) {
  const gapMs = options?.gapMs ?? BLURB_GAP_MS
  let progress = EMPTY
  let paused = false
  let running: Promise<void> | null = null
  let wake: (() => void) | null = null
  const listeners = new Set<(next: BlurbProgress) => void>()

  function push(next: Partial<BlurbProgress>): void {
    progress = { ...progress, ...next }
    for (const listener of listeners) listener(progress)
  }

  function waitGap(): Promise<void> {
    if (gapMs <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = null
        resolve()
      }, gapMs)
      wake = () => {
        clearTimeout(timer)
        wake = null
        resolve()
      }
    })
  }

  async function run(): Promise<void> {
    if (running) return running
    paused = false
    const job = (async () => {
      const skipped = new Set<string>()
      let made = 0
      let total = 0
      while (!paused) {
        const pending = (await deps.listPending()).filter((name) => !skipped.has(name))
        total = Math.max(total, made + pending.length)
        if (!pending.length) {
          const message = skipped.size
            ? '몇 개는 한 문장으로 만들지 못해서, 다음에 앱을 열면 다시 시도해요.'
            : '한글 설명을 모두 만들어 뒀어요.'
          push({ phase: 'done', done: made, total, name: '', korean: '', message })
          return
        }
        const name = pending[0]
        push({ phase: 'working', done: made, total, name, korean: '', message: '' })
        let result: { ok: boolean; message: string; korean: string }
        try {
          result = await deps.translate(name)
        } catch {
          push({ phase: 'stopped', name: '', korean: '', message: '한글 설명을 지금 만들지 못해요. 잠시 뒤에 앱을 다시 열면 이어서 해요.' })
          return
        }
        if (paused) {
          push({ phase: 'paused', name: '', korean: '' })
          return
        }
        if (!result.ok && blurbBlocked(result.message)) {
          push({ phase: 'stopped', name: '', korean: '', message: result.message })
          return
        }
        if (result.ok && result.korean) made += 1
        else skipped.add(name)
        const left = (await deps.listPending()).filter((item) => !skipped.has(item))
        push({ phase: 'working', done: made, total: Math.max(total, made + left.length), name, korean: result.korean || '', message: '' })
        const more = left
        if (!more.length || paused) break
        await waitGap()
      }
      if (paused) {
        push({ phase: 'paused', name: '', korean: '' })
        return
      }
      const message = skipped.size
        ? '몇 개는 한 문장으로 만들지 못해서, 다음에 앱을 열면 다시 시도해요.'
        : '한글 설명을 모두 만들어 뒀어요.'
      push({ phase: 'done', done: made, total, name: '', korean: '', message })
    })()
    running = job
    try {
      await job
    } finally {
      running = null
    }
  }

  return {
    run,
    start() {
      void run()
    },
    pause() {
      paused = true
      wake?.()
    },
    state: () => progress,
    subscribe(listener: (next: BlurbProgress) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
