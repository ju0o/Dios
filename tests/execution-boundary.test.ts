import crypto from 'crypto'
import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Test DB setup with audit_log table
// ---------------------------------------------------------------------------

function setupDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-eb-'))
  const db = new Database(path.join(tmpDir, 'dios.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action_type TEXT NOT NULL,
      execution_class TEXT NOT NULL CHECK(execution_class IN ('AUTONOMOUS', 'HUMAN_GATE_REQUIRED')),
      status TEXT NOT NULL CHECK(status IN ('EXECUTED', 'BLOCKED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
      payload TEXT,
      rationale TEXT,
      gate_event_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'Audit log entries are immutable and cannot be modified');
    END;

    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'Audit log entries are immutable and cannot be deleted');
    END;
  `)
  return db
}

// ---------------------------------------------------------------------------
// Inline boundary logic (mirrors execution-boundary.ts — no Electron dep)
// ---------------------------------------------------------------------------

import type {
  ActionType,
  AuditLogEntry,
  AuditStatus,
  ExecutionClass,
} from '../src/core/automation/types'
import {
  classifyAction,
  AUTONOMOUS_ACTIONS,
  HUMAN_GATE_ACTIONS,
} from '../src/core/automation/types'

interface RecordAuditInput {
  actor: string
  actionType: ActionType
  executionClass: ExecutionClass
  status: AuditStatus
  payload?: Record<string, unknown>
  rationale?: string
  gateEventId?: string
}

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

function makeRecordAudit(db: Database.Database) {
  return function recordAudit(input: RecordAuditInput): AuditLogEntry {
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
}

function makeExecuteAutonomous(db: Database.Database) {
  const recordAudit = makeRecordAudit(db)
  return function executeAutonomous<T = void>(
    input: { actor: string; actionType: ActionType; payload?: Record<string, unknown>; rationale?: string },
    fn: () => T
  ): { ok: boolean; data?: T; error?: { code: string; message: string }; auditId: string } {
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
      return { ok: false, error: { code: 'HUMAN_GATE_REQUIRED', message: `${input.actionType} 차단됨` }, auditId: entry.id }
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
        rationale: String(err),
      })
      return { ok: false, error: { code: 'EXECUTION_ERROR', message: String(err) }, auditId: entry.id }
    }
  }
}

function makeRequestHumanGate(db: Database.Database) {
  const recordAudit = makeRecordAudit(db)
  return function requestHumanGateAction(input: {
    actor: string
    actionType: ActionType
    payload?: Record<string, unknown>
    rationale: string
  }): { ok: boolean; data?: { pendingAuditId: string }; error?: { code: string; message: string }; auditId: string } {
    if (!HUMAN_GATE_ACTIONS.has(input.actionType)) {
      const entry = recordAudit({
        actor: input.actor,
        actionType: input.actionType,
        executionClass: 'AUTONOMOUS',
        status: 'BLOCKED',
        rationale: '자율 실행 범위 외 행위 요청',
      })
      return { ok: false, error: { code: 'INVALID_ACTION_CLASS', message: `${input.actionType}은 Human Gate 대상이 아닙니다.` }, auditId: entry.id }
    }
    const entry = recordAudit({
      actor: input.actor,
      actionType: input.actionType,
      executionClass: 'HUMAN_GATE_REQUIRED',
      status: 'PENDING_APPROVAL',
      payload: input.payload,
      rationale: input.rationale,
    })
    return { ok: true, data: { pendingAuditId: entry.id }, auditId: entry.id }
  }
}

// ---------------------------------------------------------------------------
// Tests: RT-16 — Execution Boundary & AuditLog
// ---------------------------------------------------------------------------

describe('RT-16: 자율 실행 범위 & Human Gate 경계 분리', () => {
  let db: Database.Database
  let executeAutonomous: ReturnType<typeof makeExecuteAutonomous>
  let requestHumanGate: ReturnType<typeof makeRequestHumanGate>
  let recordAudit: ReturnType<typeof makeRecordAudit>

  beforeEach(() => {
    db = setupDb()
    executeAutonomous = makeExecuteAutonomous(db)
    requestHumanGate = makeRequestHumanGate(db)
    recordAudit = makeRecordAudit(db)
  })

  // -------------------------------------------------------------------------
  // AC1: 모든 자율 실행 행위는 100% AuditLog에 기록됨
  // -------------------------------------------------------------------------

  it('AC1-1: SIGNAL_COLLECT 자율 실행이 AuditLog에 EXECUTED로 기록된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'SIGNAL_COLLECT' }, () => undefined)
    expect(result.ok).toBe(true)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row).toBeDefined()
    expect(row.actor).toBe('HERMES_B')
    expect(row.action_type).toBe('SIGNAL_COLLECT')
    expect(row.execution_class).toBe('AUTONOMOUS')
    expect(row.status).toBe('EXECUTED')
  })

  it('AC1-2: SIGNAL_SCORE 자율 실행이 AuditLog에 EXECUTED로 기록된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'SIGNAL_SCORE', payload: { score: 0.85 } }, () => undefined)
    expect(result.ok).toBe(true)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.action_type).toBe('SIGNAL_SCORE')
    expect(row.status).toBe('EXECUTED')
    expect(JSON.parse(row.payload!)).toEqual({ score: 0.85 })
  })

  it('AC1-3: REPORT_GENERATE 자율 실행이 AuditLog에 EXECUTED로 기록된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'REPORT_GENERATE' }, () => undefined)
    expect(result.ok).toBe(true)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.action_type).toBe('REPORT_GENERATE')
    expect(row.status).toBe('EXECUTED')
  })

  it('AC1-4: LOOP_HEARTBEAT 자율 실행이 AuditLog에 EXECUTED로 기록된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'LOOP_HEARTBEAT' }, () => undefined)
    expect(result.ok).toBe(true)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.action_type).toBe('LOOP_HEARTBEAT')
    expect(row.execution_class).toBe('AUTONOMOUS')
  })

  it('AC1-5: EXPERIMENT_DRAFT_CREATE 자율 실행이 AuditLog에 EXECUTED로 기록된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'EXPERIMENT_DRAFT_CREATE' }, () => undefined)
    expect(result.ok).toBe(true)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('EXECUTED')
  })

  it('AC1-6: EXPERIMENT_HYPOTHESIS_ADVANCE 자율 실행이 AuditLog에 EXECUTED로 기록된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'EXPERIMENT_HYPOTHESIS_ADVANCE' }, () => undefined)
    expect(result.ok).toBe(true)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('EXECUTED')
  })

  it('AC1-7: 자율 실행 중 예외 발생시 BLOCKED로 AuditLog에 기록된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'SIGNAL_COLLECT' }, () => {
      throw new Error('네트워크 오류')
    })
    expect(result.ok).toBe(false)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('BLOCKED')
    expect(row.execution_class).toBe('AUTONOMOUS')
    expect(row.rationale).toContain('네트워크 오류')
  })

  // -------------------------------------------------------------------------
  // Human Gate 경계 강제
  // -------------------------------------------------------------------------

  it('HG-1: BUSINESS_CREATE는 Human Gate 대상으로 자율 실행이 차단된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'BUSINESS_CREATE' }, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('HUMAN_GATE_REQUIRED')
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('BLOCKED')
    expect(row.execution_class).toBe('HUMAN_GATE_REQUIRED')
  })

  it('HG-2: BUDGET_CHANGE는 Human Gate 대상으로 자율 실행이 차단된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'BUDGET_CHANGE' }, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('HUMAN_GATE_REQUIRED')
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('BLOCKED')
  })

  it('HG-3: ORDER_PLACE는 Human Gate 대상으로 자율 실행이 차단된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'ORDER_PLACE' }, () => undefined)
    expect(result.ok).toBe(false)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.execution_class).toBe('HUMAN_GATE_REQUIRED')
  })

  it('HG-4: DELIVERY_ACCEPT는 Human Gate 대상으로 자율 실행이 차단된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'DELIVERY_ACCEPT' }, () => undefined)
    expect(result.ok).toBe(false)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('BLOCKED')
  })

  it('HG-5: BUSINESS_TERMINATE는 Human Gate 대상으로 자율 실행이 차단된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'BUSINESS_TERMINATE' }, () => undefined)
    expect(result.ok).toBe(false)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('BLOCKED')
  })

  it('HG-6: EXPERIMENT_VALIDATE는 Human Gate 대상으로 자율 실행이 차단된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'EXPERIMENT_VALIDATE' }, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('HUMAN_GATE_REQUIRED')
  })

  it('HG-7: EXPERIMENT_APPROVE는 Human Gate 대상으로 자율 실행이 차단된다', () => {
    const result = executeAutonomous({ actor: 'HERMES_B', actionType: 'EXPERIMENT_APPROVE' }, () => undefined)
    expect(result.ok).toBe(false)
  })

  it('HG-8: requestHumanGate가 BUSINESS_CREATE를 PENDING_APPROVAL로 AuditLog에 기록한다', () => {
    const result = requestHumanGate({
      actor: 'HERMES_B',
      actionType: 'BUSINESS_CREATE',
      payload: { name: '신사업 Alpha' },
      rationale: '시장 기회 포착',
    })
    expect(result.ok).toBe(true)
    expect(result.data?.pendingAuditId).toBeDefined()
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('PENDING_APPROVAL')
    expect(row.execution_class).toBe('HUMAN_GATE_REQUIRED')
    expect(JSON.parse(row.payload!)).toEqual({ name: '신사업 Alpha' })
  })

  it('HG-9: requestHumanGate가 BUDGET_CHANGE를 PENDING_APPROVAL로 기록한다', () => {
    const result = requestHumanGate({
      actor: 'HERMES_B',
      actionType: 'BUDGET_CHANGE',
      payload: { amount: 5000000, currency: 'KRW' },
      rationale: '분기 예산 증액 필요',
    })
    expect(result.ok).toBe(true)
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('PENDING_APPROVAL')
  })

  it('HG-10: 자율 실행 행위를 requestHumanGate로 요청하면 BLOCKED된다', () => {
    const result = requestHumanGate({
      actor: 'HERMES_B',
      actionType: 'SIGNAL_COLLECT',
      rationale: '잘못된 요청',
    })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('INVALID_ACTION_CLASS')
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId) as AuditLogRow
    expect(row.status).toBe('BLOCKED')
  })

  // -------------------------------------------------------------------------
  // Immutability: AuditLog는 수정·삭제 불가
  // -------------------------------------------------------------------------

  it('IMM-1: AuditLog 항목은 UPDATE가 불가능하다', () => {
    const entry = recordAudit({
      actor: 'HERMES_B',
      actionType: 'SIGNAL_COLLECT',
      executionClass: 'AUTONOMOUS',
      status: 'EXECUTED',
    })
    expect(() => {
      db.prepare(`UPDATE audit_log SET status = 'BLOCKED' WHERE id = ?`).run(entry.id)
    }).toThrow()
  })

  it('IMM-2: AuditLog 항목은 DELETE가 불가능하다', () => {
    const entry = recordAudit({
      actor: 'HERMES_B',
      actionType: 'SIGNAL_COLLECT',
      executionClass: 'AUTONOMOUS',
      status: 'EXECUTED',
    })
    expect(() => {
      db.prepare(`DELETE FROM audit_log WHERE id = ?`).run(entry.id)
    }).toThrow()
  })

  // -------------------------------------------------------------------------
  // Action classification correctness
  // -------------------------------------------------------------------------

  it('CLS-1: 모든 자율 실행 행위 유형이 AUTONOMOUS로 분류된다', () => {
    const autonomousTypes = [
      'SIGNAL_COLLECT', 'SIGNAL_SCORE', 'REPORT_GENERATE',
      'LOOP_HEARTBEAT', 'EXPERIMENT_DRAFT_CREATE', 'EXPERIMENT_HYPOTHESIS_ADVANCE',
    ] as const
    for (const t of autonomousTypes) {
      expect(classifyAction(t)).toBe('AUTONOMOUS')
    }
  })

  it('CLS-2: 모든 Human Gate 행위 유형이 HUMAN_GATE_REQUIRED로 분류된다', () => {
    const gatedTypes = [
      'BUSINESS_CREATE', 'BUDGET_CHANGE', 'ORDER_PLACE', 'DELIVERY_ACCEPT', 'BUSINESS_TERMINATE',
      'EXPERIMENT_VALIDATE', 'EXPERIMENT_APPROVE', 'EXPERIMENT_RUN',
      'EXPERIMENT_SCALE', 'EXPERIMENT_PIVOT', 'EXPERIMENT_HOLD', 'EXPERIMENT_TERMINATE',
    ] as const
    for (const t of gatedTypes) {
      expect(classifyAction(t)).toBe('HUMAN_GATE_REQUIRED')
    }
  })

  it('CLS-3: AUTONOMOUS_ACTIONS과 HUMAN_GATE_ACTIONS은 서로 교집합이 없다', () => {
    const autonomousArr = [...AUTONOMOUS_ACTIONS]
    const gatedArr = [...HUMAN_GATE_ACTIONS]
    const intersection = autonomousArr.filter(a => gatedArr.includes(a))
    expect(intersection).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // Audit trail completeness: 연속 실행시 모두 기록됨
  // -------------------------------------------------------------------------

  it('TRAIL-1: 복수의 자율 실행이 연속으로 모두 AuditLog에 기록된다', () => {
    const actions = [
      'SIGNAL_COLLECT', 'SIGNAL_SCORE', 'REPORT_GENERATE',
    ] as const
    const auditIds: string[] = []

    for (const actionType of actions) {
      const result = executeAutonomous({ actor: 'HERMES_B', actionType }, () => undefined)
      expect(result.ok).toBe(true)
      auditIds.push(result.auditId)
    }

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at ASC').all() as AuditLogRow[]
    expect(rows.length).toBeGreaterThanOrEqual(3)

    for (const id of auditIds) {
      const found = rows.find(r => r.id === id)
      expect(found).toBeDefined()
      expect(found?.status).toBe('EXECUTED')
    }
  })
})
