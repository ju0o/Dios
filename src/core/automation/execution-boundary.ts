import crypto from 'crypto'
import { getDatabase } from '../../../electron/db/schema'
import type {
  ActionType,
  AuditLogEntry,
  AuditStatus,
  BoundaryResponse,
  ExecuteAutonomousInput,
  ExecutionClass,
  HumanGateActionType,
  RecordAuditInput,
  RequestHumanGateInput,
} from './types'
import { classifyAction, HUMAN_GATE_ACTIONS } from './types'

interface AuditLogRow {
  id: string
  actor: string
  action_type: string
  execution_class: string
  status: string
  payload: string | null
  rationale: string | null
  gate_event_id: string | null
  created_at: number
}

function rowToEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actor: row.actor,
    actionType: row.action_type as ActionType,
    executionClass: row.execution_class as ExecutionClass,
    status: row.status as AuditStatus,
    payload: row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : null,
    rationale: row.rationale,
    gateEventId: row.gate_event_id,
    createdAt: row.created_at,
  }
}

export function recordAudit(input: RecordAuditInput): AuditLogEntry {
  const db = getDatabase()
  const id = crypto.randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO audit_log
       (id, actor, action_type, execution_class, status, payload, rationale, gate_event_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.actor,
    input.actionType,
    input.executionClass,
    input.status,
    input.payload ? JSON.stringify(input.payload) : null,
    input.rationale ?? null,
    input.gateEventId ?? null,
    now
  )

  const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as AuditLogRow
  return rowToEntry(row)
}

export function executeAutonomous<T = void>(
  input: ExecuteAutonomousInput,
  fn: () => T
): BoundaryResponse<T> {
  const executionClass = classifyAction(input.actionType)

  if (executionClass !== 'AUTONOMOUS') {
    const entry = recordAudit({
      actor: input.actor,
      actionType: input.actionType,
      executionClass: 'HUMAN_GATE_REQUIRED',
      status: 'BLOCKED',
      payload: input.payload,
      rationale: input.rationale,
    })
    return {
      ok: false,
      error: {
        code: 'HUMAN_GATE_REQUIRED',
        message: `${input.actionType}은 Human Gate 승인이 필요합니다. 자율 실행이 차단되었습니다.`,
      },
      auditId: entry.id,
    }
  }

  try {
    const result = fn()
    const entry = recordAudit({
      actor: input.actor,
      actionType: input.actionType,
      executionClass: 'AUTONOMOUS',
      status: 'EXECUTED',
      payload: input.payload,
      rationale: input.rationale,
    })
    return { ok: true, data: result, auditId: entry.id }
  } catch (err) {
    const entry = recordAudit({
      actor: input.actor,
      actionType: input.actionType,
      executionClass: 'AUTONOMOUS',
      status: 'BLOCKED',
      payload: input.payload,
      rationale: String(err),
    })
    return {
      ok: false,
      error: { code: 'EXECUTION_ERROR', message: String(err) },
      auditId: entry.id,
    }
  }
}

export function requestHumanGateAction(
  input: RequestHumanGateInput
): BoundaryResponse<{ pendingAuditId: string }> {
  const actionType = input.actionType as HumanGateActionType

  if (!HUMAN_GATE_ACTIONS.has(actionType)) {
    const entry = recordAudit({
      actor: input.actor,
      actionType: input.actionType,
      executionClass: 'AUTONOMOUS',
      status: 'BLOCKED',
      payload: input.payload,
      rationale: '자율 실행 범위 외 행위 요청',
    })
    return {
      ok: false,
      error: {
        code: 'INVALID_ACTION_CLASS',
        message: `${input.actionType}은 Human Gate 대상 행위가 아닙니다.`,
      },
      auditId: entry.id,
    }
  }

  const entry = recordAudit({
    actor: input.actor,
    actionType: input.actionType,
    executionClass: 'HUMAN_GATE_REQUIRED',
    status: 'PENDING_APPROVAL',
    payload: input.payload,
    rationale: input.rationale,
  })

  return {
    ok: true,
    data: { pendingAuditId: entry.id },
    auditId: entry.id,
  }
}

export function resolveHumanGateAction(
  auditId: string,
  approved: boolean,
  resolvedBy: string,
  gateEventId?: string
): BoundaryResponse<AuditLogEntry> {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(auditId) as AuditLogRow | undefined

  if (!row) {
    const errorEntry = recordAudit({
      actor: resolvedBy,
      actionType: 'BUSINESS_TERMINATE',
      executionClass: 'HUMAN_GATE_REQUIRED',
      status: 'BLOCKED',
      rationale: `resolve 실패: 감사 항목 ${auditId}을(를) 찾을 수 없습니다.`,
    })
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: `감사 항목 ${auditId}을(를) 찾을 수 없습니다.` },
      auditId: errorEntry.id,
    }
  }

  if (row.status !== 'PENDING_APPROVAL') {
    const entry = recordAudit({
      actor: resolvedBy,
      actionType: row.action_type as ActionType,
      executionClass: 'HUMAN_GATE_REQUIRED',
      status: 'BLOCKED',
      rationale: `이미 처리된 항목입니다. 현재 상태: ${row.status}`,
    })
    return {
      ok: false,
      error: { code: 'ALREADY_RESOLVED', message: `이미 처리된 항목입니다. 현재 상태: ${row.status}` },
      auditId: entry.id,
    }
  }

  const newStatus: AuditStatus = approved ? 'APPROVED' : 'REJECTED'
  const resolvedEntry = recordAudit({
    actor: resolvedBy,
    actionType: row.action_type as ActionType,
    executionClass: 'HUMAN_GATE_REQUIRED',
    status: newStatus,
    payload: row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : undefined,
    rationale: `원본 감사ID: ${auditId}`,
    gateEventId: gateEventId,
  })

  return { ok: true, data: resolvedEntry, auditId: resolvedEntry.id }
}

export function listAuditLog(filters?: {
  actor?: string
  executionClass?: ExecutionClass
  status?: AuditStatus
  limit?: number
}): AuditLogEntry[] {
  const db = getDatabase()

  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.actor) {
    conditions.push('actor = ?')
    params.push(filters.actor)
  }
  if (filters?.executionClass) {
    conditions.push('execution_class = ?')
    params.push(filters.executionClass)
  }
  if (filters?.status) {
    conditions.push('status = ?')
    params.push(filters.status)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limitClause = filters?.limit ? `LIMIT ${filters.limit}` : ''
  const rows = db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC ${limitClause}`)
    .all(...params) as AuditLogRow[]

  return rows.map(rowToEntry)
}

export function getAuditEntry(id: string): AuditLogEntry | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as AuditLogRow | undefined
  return row ? rowToEntry(row) : null
}
