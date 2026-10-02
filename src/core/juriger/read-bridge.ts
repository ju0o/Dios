import fs from 'fs'
import path from 'path'

/**
 * File bridge between JuRiger (writes state, consumes commands) and DIOS (reads state, writes commands).
 * DIOS never edits state.json and never talks to Ollama. Schema 1 is the only one this build understands.
 */

/** Bump only when DIOS learns a new state.json shape. Newer files are shown, not crashed on. */
export const BRIDGE_SCHEMA = 1

/**
 * How old `updated_at` may be before the screen stops trusting it.
 * Kept in one place so the product can retune them without hunting through the UI.
 * Fresh: younger than STALE. Stale: until OFFLINE. Older than OFFLINE: not connected.
 */
export const JURIGER_STALE_AFTER_MS = 2 * 60 * 1000
export const JURIGER_OFFLINE_AFTER_MS = 10 * 60 * 1000

/** A command older than this must not be created. JuRiger should ignore it even if it arrives late. */
export const JURIGER_COMMAND_TTL_MS = 10 * 60 * 1000

export const JURIGER_ACTIONS = ['open_juriger', 'run_skill', 'accept_suggestion', 'dismiss_suggestion'] as const
export type JurigerAction = (typeof JURIGER_ACTIONS)[number]

const SKILL_STATUS = ['ready', 'active', 'paused', 'failed'] as const
const RUN_RESULT = ['ok', 'failed'] as const
const SEVERITY = ['low', 'medium', 'high'] as const
const APP_STATUS = ['observing', 'paused', 'error'] as const

export interface JurigerSuggestion {
  id: string
  title: string
  plainSummary: string
  suggestedSkillName: string
  whyItMayHelp: string
  occurrenceCount: number
  severity: (typeof SEVERITY)[number] | ''
  estimatedSavedMinutesPerWeek: number
}

export interface JurigerLastRun {
  at: string
  result: (typeof RUN_RESULT)[number] | ''
  note: string
}

export interface JurigerSkill {
  id: string
  name: string
  status: (typeof SKILL_STATUS)[number] | ''
  lastRun: JurigerLastRun | null
  estimatedSavedMinutesTotal: number
}

/** One row of `recent_runs`. Unknown extra fields are dropped, never required. */
export interface JurigerRecentRun {
  id: string
  title: string
  result: (typeof RUN_RESULT)[number] | ''
  at: string
  note: string
}

export interface JurigerState {
  schema: number
  updatedAt: string
  updatedAtMs: number
  status: (typeof APP_STATUS)[number] | ''
  error: string | null
  ai: { mode: string; model: string }
  newSuggestionCount: number
  suggestions: JurigerSuggestion[]
  skills: JurigerSkill[]
  recentRuns: JurigerRecentRun[]
  savedMinutesThisWeek: number
}

export type BridgeFreshness = 'fresh' | 'stale' | 'offline'

export type BridgeRead =
  | { kind: 'missing' }
  | { kind: 'unreadable' }
  | { kind: 'unsupported'; schema: number }
  | { kind: 'ready'; freshness: BridgeFreshness; state: JurigerState }

export interface CommandWrite {
  ok: boolean
  message: string
  /** The file that was created, when ok. */
  file: string
}

/** `%LOCALAPPDATA%\JuRiger\bridge`, or `DIOS_JURIGER_BRIDGE` when set. Empty when this computer has neither. */
export function bridgeRoot(platform: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DIOS_JURIGER_BRIDGE
  if (typeof override === 'string' && override.trim()) return override.trim()
  if (platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'JuRiger', 'bridge')
  return ''
}

/** Fresh while the file is young, stale while it might just be slow, offline after that. */
export function freshnessOf(updatedAtMs: number, now: number): BridgeFreshness {
  if (!updatedAtMs || !Number.isFinite(updatedAtMs)) return 'offline'
  const age = now - updatedAtMs
  if (age < JURIGER_STALE_AFTER_MS) return 'fresh'
  if (age < JURIGER_OFFLINE_AFTER_MS) return 'stale'
  return 'offline'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | '' {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function suggestion(value: unknown): JurigerSuggestion | null {
  const row = asRecord(value)
  if (!row || !text(row.id)) return null
  return {
    id: text(row.id),
    title: text(row.title),
    plainSummary: text(row.plain_summary),
    suggestedSkillName: text(row.suggested_skill_name),
    whyItMayHelp: text(row.why_it_may_help),
    occurrenceCount: count(row.occurrence_count),
    severity: oneOf(row.severity, SEVERITY),
    estimatedSavedMinutesPerWeek: count(row.estimated_saved_minutes_per_week),
  }
}

function lastRun(value: unknown): JurigerLastRun | null {
  const row = asRecord(value)
  if (!row) return null
  return { at: text(row.at), result: oneOf(row.result, RUN_RESULT), note: text(row.note) }
}

function skill(value: unknown): JurigerSkill | null {
  const row = asRecord(value)
  if (!row || !text(row.id)) return null
  return {
    id: text(row.id),
    name: text(row.name),
    status: oneOf(row.status, SKILL_STATUS),
    lastRun: lastRun(row.last_run),
    estimatedSavedMinutesTotal: count(row.estimated_saved_minutes_total),
  }
}

function recentRun(value: unknown): JurigerRecentRun | null {
  const row = asRecord(value)
  if (!row) return null
  const title = text(row.title) || text(row.name)
  if (!title && !text(row.id) && !text(row.result)) return null
  return { id: text(row.id), title, result: oneOf(row.result, RUN_RESULT), at: text(row.at), note: text(row.note) }
}

/** Parse one state.json object. Unknown fields are ignored. Returns null when the shape is not schema 1. */
export function parseState(value: unknown): { unsupported: number } | { state: JurigerState } | null {
  const row = asRecord(value)
  if (!row || typeof row.schema !== 'number' || !Number.isFinite(row.schema)) return null
  if (row.schema > BRIDGE_SCHEMA) return { unsupported: row.schema }
  if (row.schema !== BRIDGE_SCHEMA) return null
  const updatedAt = text(row.updated_at)
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : NaN
  const ai = asRecord(row.ai)
  const suggestions = Array.isArray(row.suggestions) ? row.suggestions.flatMap((item) => { const parsed = suggestion(item); return parsed ? [parsed] : [] }) : []
  return {
    state: {
      schema: BRIDGE_SCHEMA,
      updatedAt,
      updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
      status: oneOf(row.status, APP_STATUS),
      error: row.error === null || row.error === undefined ? null : text(row.error) || null,
      ai: { mode: text(ai?.mode), model: text(ai?.model) },
      newSuggestionCount: typeof row.new_suggestion_count === 'number' ? count(row.new_suggestion_count) : suggestions.length,
      suggestions,
      skills: Array.isArray(row.skills) ? row.skills.flatMap((item) => { const parsed = skill(item); return parsed ? [parsed] : [] }) : [],
      recentRuns: Array.isArray(row.recent_runs) ? row.recent_runs.flatMap((item) => { const parsed = recentRun(item); return parsed ? [parsed] : [] }) : [],
      savedMinutesThisWeek: count(row.saved_minutes_this_week),
    },
  }
}

/** Read the bridge. Missing folder, broken JSON, and a newer schema all come back as data, never as a throw. */
export function readBridge(root: string, now: number = Date.now(), read: (file: string) => string = (file) => fs.readFileSync(file, 'utf8')): BridgeRead {
  if (!root) return { kind: 'missing' }
  const file = path.join(root, 'state.json')
  let raw = ''
  try {
    raw = read(file)
  } catch {
    return { kind: 'missing' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'unreadable' }
  }
  const result = parseState(parsed)
  if (!result) return { kind: 'unreadable' }
  if ('unsupported' in result) return { kind: 'unsupported', schema: result.unsupported }
  return { kind: 'ready', freshness: freshnessOf(result.state.updatedAtMs, now), state: result.state }
}

export interface CommandInput {
  id: string
  action: string
  targetId: string
  /** Epoch ms the command is created at. Defaults to now. */
  now?: number
  /** How long the command stays valid. Defaults to JURIGER_COMMAND_TTL_MS. Zero or less is refused. */
  ttlMs?: number
  confirmedByUser: boolean
}

function safeId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(id)
}

/**
 * Write one command file with a temp file and an atomic publish.
 * Refuses unknown actions, a second file with the same id, and a command that is already expired.
 * Does not create the bridge folder: JuRiger owns that. `commands/` is created only inside an existing bridge.
 */
export function writeCommand(root: string, input: CommandInput): CommandWrite {
  const refuse = (message: string): CommandWrite => ({ ok: false, message, file: '' })
  if (!root || !fs.existsSync(root)) return refuse('JuRiger가 이 컴퓨터에 아직 없어요.')
  if (!JURIGER_ACTIONS.includes(input.action as JurigerAction)) return refuse('그 명령은 보내지 않아요.')
  if (input.confirmedByUser !== true) return refuse('화면에서 누른 명령만 보내요.')
  if (!safeId(input.id)) return refuse('명령 번호가 올바르지 않아요.')
  const now = input.now ?? Date.now()
  const ttl = input.ttlMs ?? JURIGER_COMMAND_TTL_MS
  if (!(ttl > 0)) return refuse('이미 지난 명령은 만들지 않아요.')
  const createdAt = new Date(now).toISOString()
  const expiresAt = new Date(now + ttl).toISOString()
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) return refuse('이미 지난 명령은 만들지 않아요.')
  const dir = path.join(root, 'commands')
  const file = path.join(dir, `${input.id}.json`)
  if (fs.existsSync(file)) return refuse('같은 명령을 이미 보냈어요.')
  const body = JSON.stringify({
    id: input.id,
    action: input.action,
    target_id: input.targetId,
    created_at: createdAt,
    expires_at: expiresAt,
    confirmed_by_user: true,
  })
  try {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `${input.id}.${process.pid}.json.tmp`)
    fs.writeFileSync(tmp, body)
    try {
      fs.linkSync(tmp, file)
    } catch {
      fs.rmSync(tmp, { force: true })
      return fs.existsSync(file) ? refuse('같은 명령을 이미 보냈어요.') : refuse('명령을 저장하지 못했어요.')
    }
    fs.rmSync(tmp, { force: true })
  } catch {
    return refuse('명령을 저장하지 못했어요.')
  }
  if (fs.existsSync(path.join(dir, `${input.id}.${process.pid}.json.tmp`))) return refuse('명령을 저장하지 못했어요.')
  return { ok: true, message: 'JuRiger에 보냈어요.', file }
}
