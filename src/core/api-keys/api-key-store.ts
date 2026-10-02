import crypto from 'crypto'
import type Database from 'better-sqlite3'
import { checkInput, maskSecret, type ApiKeyCard, type ApiKeyInput } from './api-key-text'
import type { EnvFinding } from './env-scan'

/** How the secret is locked on disk. Electron gives the real lock; tests and CLI pass through. */
export interface SecretLock {
  /** False when this computer has no key store. Keys are then saved as plain text and marked so. */
  available(): boolean
  lock(plain: string): string
  unlock(locked: string): string
}

export interface KeyResult {
  ok: boolean
  message: string
  cards: ApiKeyCard[]
}

/** Everything needed to put a deleted key back. Kept in memory only. */
export interface DeletedKey {
  id: string
  project: string
  platform: string
  label: string
  keyLocked: string
  lockKind: string
  keyHint: string
  note: string
  source: string
  serviceId: string
  createdAt: number
}

export const PLAIN_LOCK: SecretLock = {
  available: () => false,
  lock: (plain) => plain,
  unlock: (locked) => locked,
}

interface Row {
  id: string
  project: string
  platform: string
  label: string
  key_locked: string
  lock_kind: string
  key_hint: string
  note: string
  source: string
  service_id: string
  health: string
  health_at: number
  created_at: number
  updated_at: number
}

const COLUMNS = 'id, project, platform, label, key_locked, lock_kind, key_hint, note, source, service_id, health, health_at, created_at, updated_at'

/** Create the table on first use. Older tables get the newer columns without losing rows. */
export function ensureApiKeyTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      platform TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      key_locked TEXT NOT NULL,
      lock_kind TEXT NOT NULL,
      key_hint TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      service_id TEXT NOT NULL DEFAULT '',
      health TEXT NOT NULL DEFAULT '',
      health_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project, platform);
  `)
  const have = new Set((db.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>).map((column) => column.name))
  if (!have.has('source')) db.exec("ALTER TABLE api_keys ADD COLUMN source TEXT NOT NULL DEFAULT ''")
  if (!have.has('service_id')) db.exec("ALTER TABLE api_keys ADD COLUMN service_id TEXT NOT NULL DEFAULT ''")
  if (!have.has('health')) db.exec("ALTER TABLE api_keys ADD COLUMN health TEXT NOT NULL DEFAULT ''")
  if (!have.has('health_at')) db.exec('ALTER TABLE api_keys ADD COLUMN health_at INTEGER NOT NULL DEFAULT 0')
}

/** Every key, hidden. Safe to send to the screen. */
export function listApiKeys(db: Database.Database): ApiKeyCard[] {
  ensureApiKeyTable(db)
  const rows = db.prepare(`SELECT ${COLUMNS} FROM api_keys ORDER BY project, platform, label`).all() as Row[]
  return rows.map(toCard)
}

/** Register one key. The secret is locked before it touches the disk. */
export function addApiKey(db: Database.Database, lock: SecretLock, raw: Partial<ApiKeyInput>, source = ''): KeyResult & { id: string } {
  ensureApiKeyTable(db)
  const checked = checkInput(raw, false)
  if (!checked.ok) return { ok: false, message: checked.message, cards: listApiKeys(db), id: '' }
  const value = checked.value
  const dup = db.prepare('SELECT id FROM api_keys WHERE project = ? AND platform = ? AND label = ?').get(value.project, value.platform, value.label)
  if (dup) return { ok: false, message: '같은 프로젝트에 같은 플랫폼·이름의 키가 이미 있어요. 이름을 다르게 적거나 그 키를 고쳐 주세요.', cards: listApiKeys(db), id: '' }
  const now = Date.now()
  const stored = storeSecret(lock, value.key)
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO api_keys (${COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, ?, ?)
  `).run(id, value.project, value.platform, value.label, stored.locked, stored.kind, maskSecret(value.key), value.note, source, now, now)
  const note = lock.available() ? '' : ' 이 컴퓨터는 키 잠금을 지원하지 않아서, 키가 그대로 저장됐어요.'
  return { ok: true, message: `${value.platform} 키를 등록했어요.${note}`, cards: listApiKeys(db), id }
}

/** Change the words around a key, and the key itself only when a new one was typed. */
export function updateApiKey(db: Database.Database, lock: SecretLock, id: string, raw: Partial<ApiKeyInput>): KeyResult & { keyChanged: boolean } {
  ensureApiKeyTable(db)
  const current = db.prepare(`SELECT ${COLUMNS} FROM api_keys WHERE id = ?`).get(id) as Row | undefined
  if (!current) return { ok: false, message: '그 키를 찾지 못했어요. 목록을 다시 불러 주세요.', cards: listApiKeys(db), keyChanged: false }
  const checked = checkInput(raw, true)
  if (!checked.ok) return { ok: false, message: checked.message, cards: listApiKeys(db), keyChanged: false }
  const value = checked.value
  const dup = db.prepare('SELECT id FROM api_keys WHERE project = ? AND platform = ? AND label = ? AND id <> ?').get(value.project, value.platform, value.label, id)
  if (dup) return { ok: false, message: '같은 프로젝트에 같은 플랫폼·이름의 키가 이미 있어요.', cards: listApiKeys(db), keyChanged: false }
  const stored = value.key ? storeSecret(lock, value.key) : { locked: current.key_locked, kind: current.lock_kind }
  const hint = value.key ? maskSecret(value.key) : current.key_hint
  const health = value.key ? '' : current.health
  const healthAt = value.key ? 0 : current.health_at
  db.prepare(`
    UPDATE api_keys SET project = ?, platform = ?, label = ?, key_locked = ?, lock_kind = ?, key_hint = ?, note = ?, health = ?, health_at = ?, updated_at = ?
    WHERE id = ?
  `).run(value.project, value.platform, value.label, stored.locked, stored.kind, hint, value.note, health, healthAt, Date.now(), id)
  return { ok: true, message: value.key ? '키를 새 것으로 바꿔 저장했어요.' : '고쳤어요. 키는 그대로예요.', cards: listApiKeys(db), keyChanged: Boolean(value.key) }
}

/** Remove one key and hand back what is needed to undo it. */
export function deleteApiKey(db: Database.Database, id: string): KeyResult & { deleted: DeletedKey | null } {
  ensureApiKeyTable(db)
  const row = db.prepare(`SELECT ${COLUMNS} FROM api_keys WHERE id = ?`).get(id) as Row | undefined
  if (!row) return { ok: false, message: '그 키는 이미 없어요.', cards: listApiKeys(db), deleted: null }
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id)
  const deleted: DeletedKey = {
    id: row.id,
    project: row.project,
    platform: row.platform,
    label: row.label,
    keyLocked: row.key_locked,
    lockKind: row.lock_kind,
    keyHint: row.key_hint,
    note: row.note,
    source: row.source,
    serviceId: row.service_id,
    createdAt: row.created_at,
  }
  return { ok: true, message: `${row.platform} 키를 지웠어요.`, cards: listApiKeys(db), deleted }
}

/** Put a deleted key back exactly as it was. */
export function restoreApiKey(db: Database.Database, deleted: DeletedKey): KeyResult {
  ensureApiKeyTable(db)
  const clash = db.prepare('SELECT id FROM api_keys WHERE id = ? OR (project = ? AND platform = ? AND label = ?)').get(deleted.id, deleted.project, deleted.platform, deleted.label)
  if (clash) return { ok: false, message: '같은 자리에 키가 이미 있어서 되돌리지 않았어요.', cards: listApiKeys(db) }
  db.prepare(`
    INSERT INTO api_keys (${COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?)
  `).run(deleted.id, deleted.project, deleted.platform, deleted.label, deleted.keyLocked, deleted.lockKind, deleted.keyHint, deleted.note, deleted.source, deleted.serviceId, deleted.createdAt, Date.now())
  return { ok: true, message: '지운 키를 되돌렸어요.', cards: listApiKeys(db) }
}

/** The real secret, for copying. Only the main process calls this. */
export function revealApiKey(db: Database.Database, lock: SecretLock, id: string): { ok: boolean; message: string; key: string } {
  ensureApiKeyTable(db)
  const row = db.prepare('SELECT key_locked, lock_kind FROM api_keys WHERE id = ?').get(id) as Pick<Row, 'key_locked' | 'lock_kind'> | undefined
  if (!row) return { ok: false, message: '그 키를 찾지 못했어요.', key: '' }
  return unlockRow(lock, row)
}

/** Every secret at once, for the "전부 보기" switch on this computer. */
export function revealAllApiKeys(db: Database.Database, lock: SecretLock): Record<string, string> {
  ensureApiKeyTable(db)
  const rows = db.prepare('SELECT id, key_locked, lock_kind FROM api_keys').all() as Array<Pick<Row, 'id' | 'key_locked' | 'lock_kind'>>
  const out: Record<string, string> = {}
  for (const row of rows) {
    const opened = unlockRow(lock, row)
    if (opened.ok) out[row.id] = opened.key
  }
  return out
}

/** Project names already used, for the form's suggestions. */
export function knownProjects(db: Database.Database, extra: string[] = []): string[] {
  ensureApiKeyTable(db)
  const rows = db.prepare('SELECT DISTINCT project FROM api_keys ORDER BY project').all() as Array<{ project: string }>
  return [...new Set([...rows.map((row) => row.project), ...extra.map((name) => name.trim()).filter(Boolean)])].sort((left, right) => left.localeCompare(right, 'ko'))
}

/**
 * Register what a folder scan found. A key already registered at the same spot is left alone,
 * even when its value differs, so a hand-edited entry is never overwritten by a stale .env.
 */
export function registerFindings(db: Database.Database, lock: SecretLock, findings: EnvFinding[]): { added: string[]; kept: number; addedByRoot: Record<string, number> } {
  ensureApiKeyTable(db)
  const added: string[] = []
  const addedByRoot: Record<string, number> = {}
  let kept = 0
  for (const finding of findings) {
    const dup = db.prepare('SELECT id FROM api_keys WHERE project = ? AND platform = ? AND label = ?').get(finding.project, finding.platform, finding.label)
    if (dup) {
      kept += 1
      continue
    }
    const result = addApiKey(db, lock, { project: finding.project, platform: finding.platform, label: finding.label, key: finding.key, note: '' }, finding.source)
    if (result.ok) {
      added.push(result.id)
      addedByRoot[finding.root] = (addedByRoot[finding.root] ?? 0) + 1
    }
  }
  return { added, kept, addedByRoot }
}

/** Remember the last liveness check. An empty state means "not checked". */
export function setKeyHealth(db: Database.Database, id: string, health: string, at: number): void {
  ensureApiKeyTable(db)
  db.prepare('UPDATE api_keys SET health = ?, health_at = ? WHERE id = ?').run(health, at, id)
}

/** Remember which usage service shows this key's spending. */
export function setKeyService(db: Database.Database, id: string, serviceId: string): void {
  ensureApiKeyTable(db)
  db.prepare('UPDATE api_keys SET service_id = ? WHERE id = ?').run(serviceId, id)
}

/** Card fields the main process needs to link a usage service. */
export function keyForService(db: Database.Database, lock: SecretLock, id: string): { project: string; platform: string; label: string; serviceId: string; key: string } | null {
  ensureApiKeyTable(db)
  const row = db.prepare(`SELECT ${COLUMNS} FROM api_keys WHERE id = ?`).get(id) as Row | undefined
  if (!row) return null
  const opened = unlockRow(lock, row)
  return { project: row.project, platform: row.platform, label: row.label, serviceId: row.service_id, key: opened.ok ? opened.key : '' }
}

function unlockRow(lock: SecretLock, row: Pick<Row, 'key_locked' | 'lock_kind'>): { ok: boolean; message: string; key: string } {
  try {
    const key = row.lock_kind === 'plain' ? row.key_locked : lock.unlock(row.key_locked)
    if (!key) return { ok: false, message: '키를 풀지 못했어요. 이 컴퓨터의 다른 사용자로 저장된 키일 수 있어요.', key: '' }
    return { ok: true, message: '', key }
  } catch {
    return { ok: false, message: '키를 풀지 못했어요. 이 컴퓨터의 다른 사용자로 저장된 키일 수 있어요.', key: '' }
  }
}

function storeSecret(lock: SecretLock, key: string): { locked: string; kind: string } {
  if (!lock.available()) return { locked: key, kind: 'plain' }
  return { locked: lock.lock(key), kind: 'os' }
}

function toCard(row: Row): ApiKeyCard {
  return {
    id: row.id,
    project: row.project,
    platform: row.platform,
    label: row.label,
    masked: row.key_hint || '••••••••',
    plain: row.lock_kind === 'plain',
    note: row.note,
    source: row.source,
    serviceId: row.service_id,
    health: row.health || '',
    healthAt: row.health_at || 0,
    updatedAt: row.updated_at,
  }
}
