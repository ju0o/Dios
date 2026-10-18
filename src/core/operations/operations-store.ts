import crypto from 'crypto'
import { getDatabase } from '../../../electron/db/schema'

export interface AppSettings {
  autoScan: boolean
  scanInterval: number
  aiProvider: string
  humanGateTimeout: number
  backupRetentionDays: number
}

export interface ConnectionInput {
  name: string
  provider?: string
  purpose?: string
  endpoint: string
  apiKey?: string
}

export interface ConnectionUsageInput {
  usageAmount: number
  estimatedCost: number
  usageUnit?: string
}

const defaultSettings: AppSettings = {
  autoScan: true,
  scanInterval: 30,
  aiProvider: 'qwen',
  humanGateTimeout: 60,
  backupRetentionDays: 30,
}

function now() {
  return Date.now()
}

export function getAppSettings(): AppSettings {
  const row = getDatabase().prepare('SELECT value_json FROM app_settings WHERE key = ?').get('app') as { value_json?: string } | undefined
  if (!row?.value_json) return defaultSettings
  try {
    return { ...defaultSettings, ...JSON.parse(row.value_json) }
  } catch {
    return defaultSettings
  }
}

export function saveAppSettings(input: Partial<AppSettings>): AppSettings {
  const settings: AppSettings = {
    ...getAppSettings(),
    ...input,
    scanInterval: Math.max(1, Number(input.scanInterval ?? getAppSettings().scanInterval) || 30),
    humanGateTimeout: Math.max(1, Number(input.humanGateTimeout ?? getAppSettings().humanGateTimeout) || 60),
    backupRetentionDays: Math.max(1, Number(input.backupRetentionDays ?? getAppSettings().backupRetentionDays) || 30),
  }
  getDatabase().prepare(`
    INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run('app', JSON.stringify(settings), now())
  return settings
}

export function listConnections() {
  return getDatabase().prepare(`
    SELECT id, name, provider, purpose, endpoint, api_key as apiKey, status,
      usage_amount as usageAmount, usage_unit as usageUnit, estimated_cost as estimatedCost,
      last_checked_at as lastCheckedAt, created_at as createdAt, updated_at as updatedAt
    FROM api_connections ORDER BY created_at DESC
  `).all()
}

export function createConnection(input: ConnectionInput) {
  if (!input.name?.trim() || !input.endpoint?.trim()) throw new Error('연동 이름과 주소는 필수입니다.')
  const id = crypto.randomUUID()
  const timestamp = now()
  getDatabase().prepare(`
    INSERT INTO api_connections (id, name, provider, purpose, endpoint, api_key, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '확인 필요', ?, ?)
  `).run(id, input.name.trim(), input.provider?.trim() || '직접 등록', input.purpose?.trim() || '', input.endpoint.trim(), input.apiKey?.trim() || '', timestamp, timestamp)
  return listConnections().find((connection: any) => connection.id === id)
}

export function updateConnection(id: string, input: Partial<ConnectionInput>) {
  const current = getDatabase().prepare('SELECT name, provider, purpose, endpoint, api_key as apiKey FROM api_connections WHERE id = ?').get(id) as any
  if (!current) throw new Error('연동 정보를 찾을 수 없습니다.')
  getDatabase().prepare(`
    UPDATE api_connections
    SET name = ?, provider = ?, purpose = ?, endpoint = ?, api_key = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name?.trim() || current.name,
    input.provider?.trim() || current.provider,
    input.purpose?.trim() ?? current.purpose,
    input.endpoint?.trim() || current.endpoint,
    input.apiKey?.trim() || current.apiKey,
    now(), id
  )
  return listConnections().find((connection: any) => connection.id === id)
}

export function deleteConnection(id: string) {
  getDatabase().prepare('DELETE FROM api_connections WHERE id = ?').run(id)
  return { success: true }
}

export async function checkConnection(id: string) {
  const row = getDatabase().prepare('SELECT endpoint, api_key as apiKey FROM api_connections WHERE id = ?').get(id) as { endpoint?: string; apiKey?: string } | undefined
  if (!row?.endpoint || !/^https?:\/\//i.test(row.endpoint)) {
    return { success: false, status: '확인 필요', error: 'http 또는 https 주소만 확인할 수 있습니다.' }
  }
  let status = '확인 필요'
  let error = ''
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(row.endpoint, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: row.apiKey ? { Authorization: `Bearer ${row.apiKey}` } : undefined,
    })
    clearTimeout(timeout)
    status = response.status < 500 ? '사용 중' : '확인 필요'
    if (response.status >= 500) error = `서버 응답 ${response.status}`
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  const timestamp = now()
  getDatabase().prepare('UPDATE api_connections SET status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?').run(status, timestamp, timestamp, id)
  return { success: status === '사용 중', status, error, lastCheckedAt: timestamp }
}

export function recordConnectionUsage(id: string, input: ConnectionUsageInput) {
  const usageAmount = Math.max(0, Number(input.usageAmount) || 0)
  const estimatedCost = Math.max(0, Number(input.estimatedCost) || 0)
  getDatabase().prepare(`
    UPDATE api_connections
    SET usage_amount = usage_amount + ?, estimated_cost = estimated_cost + ?, usage_unit = ?, updated_at = ?
    WHERE id = ?
  `).run(usageAmount, estimatedCost, input.usageUnit?.trim() || 'requests', now(), id)
  return listConnections().find((connection: any) => connection.id === id)
}

function findNumber(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(key.toLowerCase()) && typeof child === 'number') return child
    const nested = findNumber(child, keys)
    if (nested !== null) return nested
  }
  return null
}

export async function fetchConnectionUsage(id: string) {
  const row = getDatabase().prepare('SELECT endpoint, api_key as apiKey FROM api_connections WHERE id = ?').get(id) as { endpoint?: string; apiKey?: string } | undefined
  if (!row?.endpoint || !/^https?:\/\//i.test(row.endpoint)) return { success: false, error: '사용량 조회 주소가 올바르지 않습니다.' }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(row.endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: row.apiKey ? { Authorization: `Bearer ${row.apiKey}` } : undefined,
    })
    clearTimeout(timeout)
    if (!response.ok) return { success: false, error: `사용량 API 응답 ${response.status}` }
    const body = await response.json() as unknown
    const usageAmount = findNumber(body, ['usage', 'total_usage', 'requests', 'total_requests', 'count'])
    const estimatedCost = findNumber(body, ['cost', 'total_cost', 'amount'])
    if (usageAmount === null && estimatedCost === null) return { success: false, error: '지원되는 사용량·비용 필드를 찾지 못했습니다.' }
    const db = getDatabase()
    db.prepare('UPDATE api_connections SET usage_amount = COALESCE(?, usage_amount), estimated_cost = COALESCE(?, estimated_cost), last_checked_at = ?, updated_at = ? WHERE id = ?').run(usageAmount, estimatedCost, now(), now(), id)
    return { success: true, connection: listConnections().find((connection: any) => connection.id === id) }
  } catch (cause) {
    return { success: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

function seedRoadmap() {
  const db = getDatabase()
  const phaseCount = (db.prepare('SELECT COUNT(*) as count FROM roadmap_phases').get() as { count: number }).count
  if (phaseCount > 0) return
  const timestamp = now()
  const phases = [
    { name: 'Phase 1 · 기반 정리', description: 'DIOS의 폴더, 설정, API 상태를 한곳에서 관리합니다.', tasks: ['운영센터 상태 확인', '연결 폴더 등록', '기본 설정 저장'] },
    { name: 'Phase 2 · 작업 운영', description: 'Agent에게 맡긴 작업을 계획하고 검토합니다.', tasks: ['Task 완료 조건 작성', '변경 파일 검토', '테스트 결과 기록'] },
    { name: 'Phase 3 · 안전한 자동화', description: '검토 가능한 범위 안에서 반복 작업을 자동화합니다.', tasks: ['API 상태 점검', '실패 시 복구 절차 작성', '운영 로그 확인'] },
  ]
  const insertPhase = db.prepare('INSERT INTO roadmap_phases (id, name, description, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insertTask = db.prepare('INSERT INTO roadmap_tasks (id, phase_id, title, description, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const transaction = db.transaction(() => {
    phases.forEach((phase, phaseIndex) => {
      const phaseId = crypto.randomUUID()
      insertPhase.run(phaseId, phase.name, phase.description, phaseIndex === 0 ? 'active' : 'planned', phaseIndex, timestamp, timestamp)
      phase.tasks.forEach((title, taskIndex) => insertTask.run(crypto.randomUUID(), phaseId, title, '', 'todo', taskIndex, timestamp, timestamp))
    })
  })
  transaction()
}

export function listRoadmap() {
  seedRoadmap()
  const db = getDatabase()
  const phases = db.prepare('SELECT id, name, description, status, sort_order as sortOrder FROM roadmap_phases ORDER BY sort_order').all() as any[]
  const tasks = db.prepare('SELECT id, phase_id as phaseId, title, description, status, sort_order as sortOrder FROM roadmap_tasks ORDER BY sort_order').all() as any[]
  return phases.map((phase) => ({ ...phase, tasks: tasks.filter((task) => task.phaseId === phase.id) }))
}

export function updateRoadmapTask(id: string, status: 'todo' | 'in_progress' | 'done') {
  getDatabase().prepare('UPDATE roadmap_tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
  return listRoadmap()
}
