/** Platforms the Founder can pick without typing. 기타 keeps a free-text name. */
export const PLATFORMS: string[] = [
  'OpenAI',
  'Anthropic (Claude)',
  'Google (Gemini)',
  'OpenRouter',
  'xAI (Grok)',
  'Cursor',
  'GitHub',
  'Supabase',
  'Firebase',
  'AWS',
  'Vercel',
  'Notion',
  'Slack',
  'Telegram',
  'Discord',
]

export const OTHER_PLATFORM = '기타'

/** What the Founder types when registering or editing one key. */
export interface ApiKeyInput {
  project: string
  platform: string
  label: string
  /** The secret. Empty on edit means "keep the saved one". */
  key: string
  note: string
}

/**
 * A key found in a project, waiting for a yes.
 * The secret itself never rides along. `source` is only the file name.
 */
export interface PublicCandidate {
  id: string
  project: string
  placeId: string
  placeName: string
  placeKind: 'local' | 'ssh' | 'wsl'
  platform: string
  label: string
  masked: string
  source: string
  projectPath: string
}

/** One row on the screen. The secret itself never rides along. */
export interface ApiKeyCard {
  id: string
  project: string
  platform: string
  label: string
  /** Hidden key, for example "sk-…ab12". */
  masked: string
  /** True when this computer could not lock the key and it sits as plain text. */
  plain: boolean
  note: string
  /** The .env file this key was found in. Empty when typed by hand. */
  source: string
  /** Usage service that shows this key's spending. Empty when the platform has no usage lookup. */
  serviceId: string
  /** Last liveness check: ok, dead, limited, unknown, or empty when never checked. */
  health: string
  healthAt: number
  updatedAt: number
}

/** Platforms whose spending DIOS can look up, and the usage service type for each. */
export const USAGE_TYPES: Record<string, string> = {
  'OpenAI': 'openai',
  'OpenRouter': 'openrouter',
  'Anthropic (Claude)': 'claude_code',
}

/** "이번 달 12.3달러 / 50달러 (25%)" or a short reason there is nothing to show. */
export function usageLine(snapshot: { used: number; limit: number; percent: number; currency: string; status: string; error?: string } | null | undefined, hasService: boolean): string {
  if (!hasService) return ''
  if (!snapshot) return '사용량은 아직 조회하지 않았어요.'
  if (snapshot.status === 'error') return '사용량을 못 받았어요. 키나 인터넷을 확인해 주세요.'
  const unit = snapshot.currency === 'USD' ? '달러' : snapshot.currency === 'credits' ? '크레딧' : snapshot.currency === 'tokens' ? '토큰' : snapshot.currency
  const used = money(snapshot.used)
  if (!snapshot.limit) return `이번 달 ${used}${unit} 씀 · 한도는 안 정했어요`
  return `이번 달 ${used}${unit} / ${money(snapshot.limit)}${unit} (${Math.round(snapshot.percent)}%)`
}

function money(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value >= 100 ? Math.round(value).toLocaleString('ko-KR') : (Math.round(value * 100) / 100).toString()
}

export interface CheckedInput {
  ok: boolean
  message: string
  value: ApiKeyInput
}

const MAX_TEXT = 120
const MAX_NOTE = 400
const MAX_KEY = 4000

/**
 * Hide a secret for the list. The last four characters stay so two keys can be told apart.
 * Short keys give only dots.
 */
export function maskSecret(key: string): string {
  const clean = key.trim()
  if (!clean) return ''
  if (clean.length <= 8) return '••••••••'
  const tail = clean.slice(-4)
  const head = clean.length >= 16 && /^[A-Za-z]{2,4}[-_]/.test(clean) ? clean.slice(0, clean.indexOf(clean.match(/[-_]/)![0]) + 1) : ''
  return `${head}••••••••${tail}`
}

/** Trim every field and refuse what the screen cannot store. */
export function checkInput(raw: Partial<ApiKeyInput>, editing: boolean): CheckedInput {
  const value: ApiKeyInput = {
    project: one(raw.project),
    platform: one(raw.platform),
    label: one(raw.label),
    key: (raw.key ?? '').trim(),
    note: (raw.note ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_NOTE),
  }
  if (!value.project) return { ok: false, message: '어느 프로젝트에 쓰는 키인지 적어 주세요.', value }
  if (!value.platform) return { ok: false, message: '어느 플랫폼의 키인지 골라 주세요.', value }
  if (!editing && !value.key) return { ok: false, message: 'API 키를 붙여 넣어 주세요.', value }
  if (value.key.length > MAX_KEY) return { ok: false, message: '키가 너무 길어요. 다시 확인해 주세요.', value }
  if (/\s/.test(value.key)) return { ok: false, message: '키 안에 빈칸이나 줄바꿈이 있어요. 키만 붙여 넣어 주세요.', value }
  return { ok: true, message: '', value }
}

/** Group cards by project, projects in name order, cards by platform then label. */
export function groupByProject(cards: ApiKeyCard[]): Array<{ project: string; cards: ApiKeyCard[] }> {
  const map = new Map<string, ApiKeyCard[]>()
  for (const card of cards) {
    const list = map.get(card.project) ?? []
    list.push(card)
    map.set(card.project, list)
  }
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'ko'))
    .map(([project, list]) => ({
      project,
      cards: [...list].sort((left, right) => left.platform.localeCompare(right.platform, 'ko') || left.label.localeCompare(right.label, 'ko')),
    }))
}

/** One line for the top of the screen. */
export function headline(cards: ApiKeyCard[]): string {
  if (!cards.length) return '아직 등록한 API 키가 없어요. 아래에서 첫 키를 등록해 보세요.'
  const projects = new Set(cards.map((card) => card.project)).size
  return `프로젝트 ${projects}개에 API 키 ${cards.length}개가 등록돼 있어요. 키는 이 컴퓨터 안에만 저장돼요.`
}

function one(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}
