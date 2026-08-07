import crypto from 'crypto'
import { getDatabase } from '../../../electron/db/schema'
import type {
  AIResource,
  AIResourceResponse,
  CostStatus,
  CreateAIResourceInput,
  RecordUsageInput,
  UsageRecordedResult,
} from './types'

interface AIResourceRow {
  id: string
  name: string
  provider: string
  monthly_cap: number
  estimated_cost: number
  status: string
  created_at: number
  updated_at: number
}

function rowToResource(row: AIResourceRow): AIResource {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    monthlyCap: row.monthly_cap,
    estimatedCost: row.estimated_cost,
    status: row.status as CostStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function computeStatus(estimatedCost: number, monthlyCap: number): CostStatus {
  if (monthlyCap <= 0) return 'normal'
  const ratio = estimatedCost / monthlyCap
  if (ratio >= 1.0) return 'hard_stop'
  if (ratio >= 0.8) return 'warning'
  return 'normal'
}

export function listAIResources(): AIResourceResponse<AIResource[]> {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM ai_resources ORDER BY name').all() as AIResourceRow[]
    return { ok: true, data: rows.map(rowToResource) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function getAIResource(id: string): AIResourceResponse<AIResource> {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id) as AIResourceRow | undefined
    if (!row) {
      return { ok: false, error: { code: 'RESOURCE_NOT_FOUND', message: `리소스 ${id}를 찾을 수 없습니다.`, resourceId: id } }
    }
    return { ok: true, data: rowToResource(row) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function createAIResource(input: CreateAIResourceInput): AIResourceResponse<AIResource> {
  if (!input.name.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'name은 필수입니다.' } }
  }
  if (!input.provider.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'provider는 필수입니다.' } }
  }
  if (input.monthlyCap <= 0) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'monthlyCap은 0보다 커야 합니다.' } }
  }

  try {
    const db = getDatabase()
    const id = crypto.randomUUID()
    const now = Date.now()

    db.prepare(
      `INSERT INTO ai_resources (id, name, provider, monthly_cap, estimated_cost, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'normal', ?, ?)`
    ).run(id, input.name.trim(), input.provider.trim(), input.monthlyCap, now, now)

    const row = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id) as AIResourceRow
    return { ok: true, data: rowToResource(row) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function updateAIResource(id: string, input: Partial<CreateAIResourceInput>): AIResourceResponse<AIResource> {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id) as AIResourceRow | undefined
    if (!row) {
      return { ok: false, error: { code: 'RESOURCE_NOT_FOUND', message: `리소스 ${id}를 찾을 수 없습니다.`, resourceId: id } }
    }

    const now = Date.now()
    const name = input.name?.trim() || row.name
    const provider = input.provider?.trim() || row.provider
    const monthlyCap = input.monthlyCap ?? row.monthly_cap
    const newStatus = computeStatus(row.estimated_cost, monthlyCap)

    db.prepare(
      `UPDATE ai_resources SET name = ?, provider = ?, monthly_cap = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(name, provider, monthlyCap, newStatus, now, id)

    const updated = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id) as AIResourceRow
    return { ok: true, data: rowToResource(updated) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function recordUsage(input: RecordUsageInput): AIResourceResponse<UsageRecordedResult> {
  if (!input.resourceId.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'resourceId는 필수입니다.' } }
  }
  if (input.cost < 0) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'cost는 0 이상이어야 합니다.' } }
  }

  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(input.resourceId) as AIResourceRow | undefined
    if (!row) {
      return { ok: false, error: { code: 'RESOURCE_NOT_FOUND', message: `리소스 ${input.resourceId}를 찾을 수 없습니다.`, resourceId: input.resourceId } }
    }

    if (row.status === 'hard_stop') {
      return { ok: false, error: { code: 'HARD_STOP_ACTIVE', message: '리소스가 하드 정지 상태입니다. 사용 불가.', resourceId: input.resourceId } }
    }

    const previousStatus = row.status as CostStatus
    const now = Date.now()
    const usageId = crypto.randomUUID()
    const newEstimatedCost = row.estimated_cost + input.cost
    const newStatus = computeStatus(newEstimatedCost, row.monthly_cap)

    // 사용량 기록
    db.prepare(
      `INSERT INTO usage_history (id, resource_id, cost, created_at) VALUES (?, ?, ?, ?)`
    ).run(usageId, input.resourceId, input.cost, now)

    // 리소스 업데이트
    db.prepare(
      `UPDATE ai_resources SET estimated_cost = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(newEstimatedCost, newStatus, now, input.resourceId)

    const softWarningTriggered = previousStatus === 'normal' && newStatus === 'warning'
    const hardStopTriggered = previousStatus !== 'hard_stop' && newStatus === 'hard_stop'

    const updatedRow = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(input.resourceId) as AIResourceRow

    return {
      ok: true,
      data: {
        resource: rowToResource(updatedRow),
        previousStatus,
        newStatus,
        softWarningTriggered,
        hardStopTriggered,
      },
    }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function resetMonthlyUsage(resourceId: string): AIResourceResponse<AIResource> {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(resourceId) as AIResourceRow | undefined
    if (!row) {
      return { ok: false, error: { code: 'RESOURCE_NOT_FOUND', message: `리소스 ${resourceId}를 찾을 수 없습니다.`, resourceId } }
    }

    const now = Date.now()
    db.prepare(
      `UPDATE ai_resources SET estimated_cost = 0, status = 'normal', updated_at = ? WHERE id = ?`
    ).run(now, resourceId)

    // 이번 달 사용량 기록 삭제
    db.prepare(`DELETE FROM usage_history WHERE resource_id = ?`).run(resourceId)

    const updated = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(resourceId) as AIResourceRow
    return { ok: true, data: rowToResource(updated) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function getUsageHistory(resourceId: string): AIResourceResponse<Array<{ id: string; resourceId: string; cost: number; createdAt: number }>> {
  try {
    const db = getDatabase()
    const rows = db.prepare(
      'SELECT * FROM usage_history WHERE resource_id = ? ORDER BY created_at DESC'
    ).all(resourceId) as Array<{ id: string; resource_id: string; cost: number; created_at: number }>
    return {
      ok: true,
      data: rows.map(r => ({ id: r.id, resourceId: r.resource_id, cost: r.cost, createdAt: r.created_at })),
    }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}
