/** Whether a saved key still works. Empty means nobody has checked it yet. */
export type KeyHealth = 'ok' | 'dead' | 'limited' | 'unknown'

export interface ProbeTarget {
  url: string
  headers: Record<string, string>
}

/**
 * A cheap read-only request per platform. Nothing is created and nothing is billed.
 * OpenAI's usage page rejects normal keys, so liveness uses the model list instead.
 */
const PROBES: Partial<Record<string, (key: string) => ProbeTarget>> = {
  OpenAI: (key) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  'Anthropic (Claude)': (key) => ({
    url: 'https://api.anthropic.com/v1/models',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }),
  OpenRouter: (key) => ({
    url: 'https://openrouter.ai/api/v1/key',
    headers: { Authorization: `Bearer ${key}` },
  }),
  'Google (Gemini)': (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: {},
  }),
  'xAI (Grok)': (key) => ({
    url: 'https://api.x.ai/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  GitHub: (key) => ({
    url: 'https://api.github.com/user',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json', 'User-Agent': 'DIOS' },
  }),
  Groq: (key) => ({
    url: 'https://api.groq.com/openai/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  Mistral: (key) => ({
    url: 'https://api.mistral.ai/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
}

/** Where to ask, or null when this platform has no check yet. */
export function probeTarget(platform: string, key: string): ProbeTarget | null {
  const build = PROBES[platform]
  if (!build || !key) return null
  return build(key)
}

export function canProbe(platform: string): boolean {
  return Boolean(PROBES[platform])
}

/** 2xx works, 401/403 is rejected, 429 is over the limit. Anything else is unclear. */
export function healthFromStatus(status: number): KeyHealth {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401 || status === 403) return 'dead'
  if (status === 429) return 'limited'
  return 'unknown'
}

/**
 * A usage lookup that failed because the key itself was rejected.
 * OpenAI's usage address rejects ordinary keys, so that 401 is ignored here.
 */
export function healthFromUsageError(error: string | undefined, serviceType: string): KeyHealth | '' {
  if (!error || serviceType !== 'openrouter') return ''
  if (/API error: (401|403)\b/.test(error)) return 'dead'
  if (/API error: 429\b/.test(error)) return 'limited'
  return ''
}

/** One Korean word for the card. */
export function healthLabel(state: string): string {
  if (state === 'ok') return '잘 돼요'
  if (state === 'dead') return '안 통해요'
  if (state === 'limited') return '한도 초과'
  if (state === 'unknown') return '확인 못 함'
  return ''
}

/** One line after checking every key. */
export function checkSummary(counts: { ok: number; dead: number; limited: number; unknown: number }): string {
  const checked = counts.ok + counts.dead + counts.limited + counts.unknown
  if (!checked) return '확인할 수 있는 플랫폼 키가 없어요. OpenAI, Claude, GitHub 같은 키를 등록하면 확인해요.'
  const parts = [`키 ${checked}개를 확인했어요.`]
  if (counts.ok) parts.push(`${counts.ok}개는 잘 돼요.`)
  if (counts.dead) parts.push(`${counts.dead}개는 안 통해요.`)
  if (counts.limited) parts.push(`${counts.limited}개는 한도를 넘겼어요.`)
  if (counts.unknown) parts.push(`${counts.unknown}개는 확인하지 못했어요.`)
  return parts.join(' ')
}

/** Ask the platform whether this key still works. `fetchImpl` is injectable for tests. */
export async function probeKey(platform: string, key: string, fetchImpl: typeof fetch = fetch): Promise<KeyHealth> {
  const target = probeTarget(platform, key)
  if (!target) return 'unknown'
  try {
    const response = await fetchImpl(target.url, { method: 'GET', headers: target.headers, signal: AbortSignal.timeout(8000) })
    return healthFromStatus(response.status)
  } catch {
    return 'unknown'
  }
}
