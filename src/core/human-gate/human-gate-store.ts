import crypto from 'crypto'
import { getDatabase } from '../../../electron/db/schema'
import type {
  ApproveThresholdChangeInput,
  CreateHumanGateInput,
  HumanGateConfig,
  HumanGateEvent,
  HumanGateLevel,
  HumanGateResponse,
  ThresholdChangeResult,
  UpdateThresholdInput,
} from './types'
import { DEFAULT_GATES } from './types'

interface HumanGateConfigRow {
  id: string
  level: string
  name: string
  description: string
  soft_threshold: number
  hard_threshold: number
  enabled: number
  created_at: number
  updated_at: number
}

interface HumanGateEventRow {
  id: string
  gate_id: string
  event_type: string
  triggered_by: string
  old_value: string | null
  new_value: string | null
  approved: number | null
  approved_by: string | null
  approved_at: number | null
  rationale: string | null
  created_at: number
}

function rowToConfig(row: HumanGateConfigRow): HumanGateConfig {
  return {
    id: row.id,
    level: row.level as HumanGateLevel,
    name: row.name,
    description: row.description,
    softThreshold: row.soft_threshold,
    hardThreshold: row.hard_threshold,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToEvent(row: HumanGateEventRow): HumanGateEvent {
  return {
    id: row.id,
    gateId: row.gate_id,
    eventType: row.event_type as HumanGateEvent['eventType'],
    triggeredBy: row.triggered_by,
    oldValue: row.old_value,
    newValue: row.new_value,
    approved: row.approved === null ? null : row.approved === 1,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rationale: row.rationale,
    createdAt: row.created_at,
  }
}

export function createHumanGate(
  input: CreateHumanGateInput
): HumanGateResponse<HumanGateConfig> {
  if (!input.name.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'name은 필수입니다.' } }
  }
  if (input.softThreshold < 0 || input.softThreshold > 1) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'softThreshold는 0~1 사이여야 합니다.' } }
  }
  if (input.hardThreshold < 0 || input.hardThreshold > 1) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'hardThreshold는 0~1 사이여야 합니다.' } }
  }
  if (input.softThreshold >= input.hardThreshold) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'softThreshold는 hardThreshold보다 작아야 합니다.' } }
  }

  try {
    const db = getDatabase()
    const id = crypto.randomUUID()
    const now = Date.now()

    db.prepare(
      `INSERT INTO human_gate_config
         (id, level, name, description, soft_threshold, hard_threshold, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, input.level, input.name.trim(), input.description.trim(), input.softThreshold, input.hardThreshold, now, now)

    const row = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(id) as HumanGateConfigRow
    return { ok: true, data: rowToConfig(row) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function getHumanGate(id: string): HumanGateResponse<HumanGateConfig> {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(id) as HumanGateConfigRow | undefined
    if (!row) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `게이트 ${id}를 찾을 수 없습니다.` } }
    }
    return { ok: true, data: rowToConfig(row) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function listHumanGates(): HumanGateResponse<HumanGateConfig[]> {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM human_gate_config ORDER BY level ASC, created_at ASC').all() as HumanGateConfigRow[]
    return { ok: true, data: rows.map(rowToConfig) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function seedDefaultGates(): HumanGateResponse<HumanGateConfig[]> {
  try {
    const db = getDatabase()
    const existing = db.prepare('SELECT COUNT(*) as cnt FROM human_gate_config').get() as { cnt: number }
    if (existing.cnt > 0) {
      return listHumanGates()
    }

    const created: HumanGateConfig[] = []
    for (const gate of DEFAULT_GATES) {
      const result = createHumanGate(gate)
      if (!result.ok) return result
      created.push(result.data)
    }
    return { ok: true, data: created }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function requestThresholdChange(
  input: UpdateThresholdInput
): HumanGateResponse<ThresholdChangeResult> {
  if (!input.requestedBy.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'requestedBy는 필수입니다.' } }
  }
  if (!input.rationale.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'rationale은 필수입니다.' } }
  }
  if (input.softThreshold < 0 || input.softThreshold > 1) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'softThreshold는 0~1 사이여야 합니다.' } }
  }
  if (input.hardThreshold < 0 || input.hardThreshold > 1) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'hardThreshold는 0~1 사이여야 합니다.' } }
  }
  if (input.softThreshold >= input.hardThreshold) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'softThreshold는 hardThreshold보다 작아야 합니다.' } }
  }

  try {
    const db = getDatabase()
    const gateRow = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(input.gateId) as HumanGateConfigRow | undefined
    if (!gateRow) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `게이트 ${input.gateId}를 찾을 수 없습니다.` } }
    }
    if (!gateRow.enabled) {
      return { ok: false, error: { code: 'GATE_DISABLED', message: '비활성화된 게이트의 임계값은 변경할 수 없습니다.' } }
    }

    const oldValue = JSON.stringify({ softThreshold: gateRow.soft_threshold, hardThreshold: gateRow.hard_threshold })
    const newValue = JSON.stringify({ softThreshold: input.softThreshold, hardThreshold: input.hardThreshold })

    const eventId = crypto.randomUUID()
    const now = Date.now()

    db.prepare(
      `INSERT INTO human_gate_events
         (id, gate_id, event_type, triggered_by, old_value, new_value, approved, approved_by, approved_at, rationale, created_at)
       VALUES (?, ?, 'THRESHOLD_CHANGE', ?, ?, ?, NULL, NULL, NULL, ?, ?)`
    ).run(eventId, input.gateId, input.requestedBy.trim(), oldValue, newValue, input.rationale.trim(), now)

    const eventRow = db.prepare('SELECT * FROM human_gate_events WHERE id = ?').get(eventId) as HumanGateEventRow

    return {
      ok: true,
      data: {
        event: rowToEvent(eventRow),
        gateTriggered: true,
        pendingApproval: true,
      },
    }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function approveThresholdChange(
  input: ApproveThresholdChangeInput
): HumanGateResponse<{ event: HumanGateEvent; gate: HumanGateConfig }> {
  if (!input.approvedBy.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'approvedBy는 필수입니다.' } }
  }

  try {
    const db = getDatabase()
    const eventRow = db.prepare('SELECT * FROM human_gate_events WHERE id = ?').get(input.eventId) as HumanGateEventRow | undefined
    if (!eventRow) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `이벤트 ${input.eventId}를 찾을 수 없습니다.` } }
    }
    if (eventRow.event_type !== 'THRESHOLD_CHANGE') {
      return { ok: false, error: { code: 'INVALID_EVENT', message: '임계값 변경 이벤트가 아닙니다.' } }
    }
    if (eventRow.approved !== null) {
      return { ok: false, error: { code: 'ALREADY_RESOLVED', message: '이미 처리된 이벤트입니다.' } }
    }

    const now = Date.now()
    db.prepare(
      `UPDATE human_gate_events SET approved = ?, approved_by = ?, approved_at = ?, rationale = ? WHERE id = ?`
    ).run(input.approved ? 1 : 0, input.approvedBy.trim(), now, input.rationale ?? null, input.eventId)

    if (input.approved && eventRow.new_value) {
      const { softThreshold, hardThreshold } = JSON.parse(eventRow.new_value) as { softThreshold: number; hardThreshold: number }
      db.prepare(
        `UPDATE human_gate_config SET soft_threshold = ?, hard_threshold = ?, updated_at = ? WHERE id = ?`
      ).run(softThreshold, hardThreshold, now, eventRow.gate_id)
    }

    const updatedEvent = db.prepare('SELECT * FROM human_gate_events WHERE id = ?').get(input.eventId) as HumanGateEventRow
    const updatedGate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(eventRow.gate_id) as HumanGateConfigRow

    return {
      ok: true,
      data: {
        event: rowToEvent(updatedEvent),
        gate: rowToConfig(updatedGate),
      },
    }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function listGateEvents(gateId: string): HumanGateResponse<HumanGateEvent[]> {
  try {
    const db = getDatabase()
    const rows = db.prepare(
      'SELECT * FROM human_gate_events WHERE gate_id = ? ORDER BY created_at DESC'
    ).all(gateId) as HumanGateEventRow[]
    return { ok: true, data: rows.map(rowToEvent) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function listPendingEvents(): HumanGateResponse<HumanGateEvent[]> {
  try {
    const db = getDatabase()
    const rows = db.prepare(
      'SELECT * FROM human_gate_events WHERE approved IS NULL ORDER BY created_at ASC'
    ).all() as HumanGateEventRow[]
    return { ok: true, data: rows.map(rowToEvent) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function setGateEnabled(
  gateId: string,
  enabled: boolean,
  requestedBy: string
): HumanGateResponse<HumanGateConfig> {
  if (!requestedBy.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'requestedBy는 필수입니다.' } }
  }

  try {
    const db = getDatabase()
    const gateRow = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId) as HumanGateConfigRow | undefined
    if (!gateRow) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `게이트 ${gateId}를 찾을 수 없습니다.` } }
    }

    const now = Date.now()
    const eventType = enabled ? 'ENABLE' : 'DISABLE'

    db.prepare(
      `INSERT INTO human_gate_events
         (id, gate_id, event_type, triggered_by, old_value, new_value, approved, approved_by, approved_at, rationale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?)`
    ).run(crypto.randomUUID(), gateId, eventType, requestedBy.trim(),
      String(gateRow.enabled === 1), String(enabled), requestedBy.trim(), now, now)

    db.prepare(
      `UPDATE human_gate_config SET enabled = ?, updated_at = ? WHERE id = ?`
    ).run(enabled ? 1 : 0, now, gateId)

    const updated = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId) as HumanGateConfigRow
    return { ok: true, data: rowToConfig(updated) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}
