import crypto from 'crypto'
import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

function setupHumanGateDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-hg-'))
  const db = new Database(path.join(tmpDir, 'test.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS human_gate_config (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      soft_threshold REAL NOT NULL,
      hard_threshold REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS human_gate_events (
      id TEXT PRIMARY KEY,
      gate_id TEXT NOT NULL REFERENCES human_gate_config(id),
      event_type TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      approved INTEGER,
      approved_by TEXT,
      approved_at INTEGER,
      rationale TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS human_gate_config_no_delete
    BEFORE DELETE ON human_gate_config
    BEGIN
      SELECT RAISE(ABORT, 'Human Gate config entries cannot be deleted; disable instead');
    END;
  `)
  return db
}

type HumanGateLevel = 'COMPANY' | 'FINANCE' | 'AI_RESOURCE' | 'GOVERNANCE'

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

function createGate(
  db: Database.Database,
  level: HumanGateLevel,
  name: string,
  softThreshold: number,
  hardThreshold: number
): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO human_gate_config
       (id, level, name, description, soft_threshold, hard_threshold, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, level, name, `${name} description`, softThreshold, hardThreshold, now, now)
  return id
}

function requestThresholdChange(
  db: Database.Database,
  gateId: string,
  softThreshold: number,
  hardThreshold: number,
  requestedBy: string,
  rationale: string
): { eventId: string; gateTriggered: boolean; pendingApproval: boolean } | { error: string } {
  if (!requestedBy.trim()) return { error: 'requestedBy는 필수입니다.' }
  if (!rationale.trim()) return { error: 'rationale은 필수입니다.' }
  if (softThreshold < 0 || softThreshold > 1) return { error: 'softThreshold 범위 오류' }
  if (hardThreshold < 0 || hardThreshold > 1) return { error: 'hardThreshold 범위 오류' }
  if (softThreshold >= hardThreshold) return { error: 'softThreshold는 hardThreshold보다 작아야 합니다.' }

  const gateRow = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId) as HumanGateConfigRow | undefined
  if (!gateRow) return { error: `게이트 ${gateId}를 찾을 수 없습니다.` }
  if (!gateRow.enabled) return { error: '비활성화된 게이트의 임계값은 변경할 수 없습니다.' }

  const oldValue = JSON.stringify({ softThreshold: gateRow.soft_threshold, hardThreshold: gateRow.hard_threshold })
  const newValue = JSON.stringify({ softThreshold, hardThreshold })
  const eventId = crypto.randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO human_gate_events
       (id, gate_id, event_type, triggered_by, old_value, new_value, approved, approved_by, approved_at, rationale, created_at)
     VALUES (?, ?, 'THRESHOLD_CHANGE', ?, ?, ?, NULL, NULL, NULL, ?, ?)`
  ).run(eventId, gateId, requestedBy.trim(), oldValue, newValue, rationale.trim(), now)

  return { eventId, gateTriggered: true, pendingApproval: true }
}

function approveThresholdChange(
  db: Database.Database,
  eventId: string,
  approvedBy: string,
  approved: boolean,
  rationale?: string
): { ok: true } | { error: string } {
  if (!approvedBy.trim()) return { error: 'approvedBy는 필수입니다.' }

  const eventRow = db.prepare('SELECT * FROM human_gate_events WHERE id = ?').get(eventId) as HumanGateEventRow | undefined
  if (!eventRow) return { error: `이벤트 ${eventId}를 찾을 수 없습니다.` }
  if (eventRow.event_type !== 'THRESHOLD_CHANGE') return { error: '임계값 변경 이벤트가 아닙니다.' }
  if (eventRow.approved !== null) return { error: '이미 처리된 이벤트입니다.' }

  const now = Date.now()
  db.prepare(
    `UPDATE human_gate_events SET approved = ?, approved_by = ?, approved_at = ?, rationale = ? WHERE id = ?`
  ).run(approved ? 1 : 0, approvedBy.trim(), now, rationale ?? null, eventId)

  if (approved && eventRow.new_value) {
    const { softThreshold, hardThreshold } = JSON.parse(eventRow.new_value) as { softThreshold: number; hardThreshold: number }
    db.prepare(
      `UPDATE human_gate_config SET soft_threshold = ?, hard_threshold = ?, updated_at = ? WHERE id = ?`
    ).run(softThreshold, hardThreshold, now, eventRow.gate_id)
  }

  return { ok: true }
}

describe('RT-14: Human Gate — 임계값 변경 시 게이트 발동', () => {
  let db: Database.Database

  beforeEach(() => { db = setupHumanGateDb() })
  afterEach(() => { db.close() })

  test('임계값 변경 요청 시 THRESHOLD_CHANGE 이벤트가 즉시 생성된다 (AC-1)', () => {
    const gateId = createGate(db, 'COMPANY', '회사 수준 게이트', 0.7, 0.9)
    const result = requestThresholdChange(db, gateId, 0.6, 0.85, 'alice@example.com', '정책 변경으로 인한 조정')
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.gateTriggered).toBe(true)
    expect(result.pendingApproval).toBe(true)

    const event = db.prepare('SELECT * FROM human_gate_events WHERE id = ?').get(result.eventId) as HumanGateEventRow
    expect(event).toBeTruthy()
    expect(event.event_type).toBe('THRESHOLD_CHANGE')
    expect(event.approved).toBeNull()
  })

  test('임계값 변경 요청 후 승인 전까지 실제 임계값은 변경되지 않는다 (우회 차단)', () => {
    const gateId = createGate(db, 'FINANCE', '재무 수준 게이트', 0.6, 0.8)
    requestThresholdChange(db, gateId, 0.4, 0.7, 'bob@example.com', '재무 정책 완화')

    const gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId) as HumanGateConfigRow
    expect(gate.soft_threshold).toBe(0.6)
    expect(gate.hard_threshold).toBe(0.8)
  })

  test('승인 후에만 임계값이 실제로 적용된다', () => {
    const gateId = createGate(db, 'AI_RESOURCE', 'AI 리소스 게이트', 0.5, 0.75)
    const reqResult = requestThresholdChange(db, gateId, 0.4, 0.65, 'carol@example.com', 'AI 예산 절감')
    if ('error' in reqResult) throw new Error(reqResult.error)

    approveThresholdChange(db, reqResult.eventId, 'approver@example.com', true, '검토 후 승인')

    const gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId) as HumanGateConfigRow
    expect(gate.soft_threshold).toBe(0.4)
    expect(gate.hard_threshold).toBe(0.65)
  })

  test('거부 시 임계값이 변경되지 않는다', () => {
    const gateId = createGate(db, 'GOVERNANCE', '거버넌스 게이트', 0.8, 1.0)
    const reqResult = requestThresholdChange(db, gateId, 0.5, 0.7, 'dave@example.com', '임시 완화')
    if ('error' in reqResult) throw new Error(reqResult.error)

    approveThresholdChange(db, reqResult.eventId, 'approver@example.com', false, '정책 위반으로 거부')

    const gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId) as HumanGateConfigRow
    expect(gate.soft_threshold).toBe(0.8)
    expect(gate.hard_threshold).toBe(1.0)
  })

  test('요청자 미입력 시 게이트 요청이 거부된다', () => {
    const gateId = createGate(db, 'COMPANY', '회사 게이트', 0.7, 0.9)
    const result = requestThresholdChange(db, gateId, 0.6, 0.85, '', '사유 있음')
    expect('error' in result).toBe(true)
    const events = db.prepare('SELECT COUNT(*) as cnt FROM human_gate_events').get() as any
    expect(events.cnt).toBe(0)
  })

  test('변경 사유 미입력 시 게이트 요청이 거부된다', () => {
    const gateId = createGate(db, 'COMPANY', '회사 게이트', 0.7, 0.9)
    const result = requestThresholdChange(db, gateId, 0.6, 0.85, 'alice@example.com', '')
    expect('error' in result).toBe(true)
    const events = db.prepare('SELECT COUNT(*) as cnt FROM human_gate_events').get() as any
    expect(events.cnt).toBe(0)
  })

  test('soft >= hard 임계값은 게이트 요청이 거부된다', () => {
    const gateId = createGate(db, 'FINANCE', '재무 게이트', 0.6, 0.8)
    const result = requestThresholdChange(db, gateId, 0.8, 0.8, 'alice@example.com', '사유')
    expect('error' in result).toBe(true)
  })

  test('비활성화된 게이트의 임계값은 변경할 수 없다', () => {
    const gateId = createGate(db, 'AI_RESOURCE', 'AI 게이트', 0.5, 0.75)
    db.prepare('UPDATE human_gate_config SET enabled = 0 WHERE id = ?').run(gateId)
    const result = requestThresholdChange(db, gateId, 0.4, 0.65, 'alice@example.com', '변경 시도')
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toContain('비활성화')
  })

  test('이미 처리된 이벤트를 재처리하면 거부된다', () => {
    const gateId = createGate(db, 'COMPANY', '회사 게이트', 0.7, 0.9)
    const reqResult = requestThresholdChange(db, gateId, 0.6, 0.85, 'alice@example.com', '사유')
    if ('error' in reqResult) throw new Error(reqResult.error)

    approveThresholdChange(db, reqResult.eventId, 'approver@example.com', true)
    const result = approveThresholdChange(db, reqResult.eventId, 'approver2@example.com', true)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toContain('이미 처리')
  })

  test('Human Gate config 삭제는 DB 트리거에 의해 차단된다', () => {
    const gateId = createGate(db, 'GOVERNANCE', '거버넌스 게이트', 0.8, 1.0)
    expect(() => {
      db.prepare('DELETE FROM human_gate_config WHERE id = ?').run(gateId)
    }).toThrow(/cannot be deleted/)
  })
})

describe('RT-15: Human Gate — 4개 수준 게이트 시드 및 독립성', () => {
  let db: Database.Database

  beforeEach(() => { db = setupHumanGateDb() })
  afterEach(() => { db.close() })

  function seedDefaultGates(): void {
    const defaults = [
      { level: 'COMPANY' as HumanGateLevel, name: '회사 수준 게이트', soft: 0.7, hard: 0.9 },
      { level: 'FINANCE' as HumanGateLevel, name: '재무 수준 게이트', soft: 0.6, hard: 0.8 },
      { level: 'AI_RESOURCE' as HumanGateLevel, name: 'AI 리소스 수준 게이트', soft: 0.5, hard: 0.75 },
      { level: 'GOVERNANCE' as HumanGateLevel, name: '거버넌스 수준 게이트', soft: 0.8, hard: 1.0 },
    ]
    for (const g of defaults) {
      createGate(db, g.level, g.name, g.soft, g.hard)
    }
  }

  test('4개 기본 게이트가 모두 생성된다', () => {
    seedDefaultGates()
    const rows = db.prepare('SELECT * FROM human_gate_config').all()
    expect(rows).toHaveLength(4)
  })

  test('각 게이트 수준이 고유하다', () => {
    seedDefaultGates()
    const rows = db.prepare('SELECT DISTINCT level FROM human_gate_config').all() as any[]
    expect(rows).toHaveLength(4)
    const levels = rows.map(r => r.level)
    expect(levels).toContain('COMPANY')
    expect(levels).toContain('FINANCE')
    expect(levels).toContain('AI_RESOURCE')
    expect(levels).toContain('GOVERNANCE')
  })

  test('한 게이트의 임계값 변경이 다른 게이트에 영향을 주지 않는다', () => {
    seedDefaultGates()
    const companyId = (db.prepare("SELECT id FROM human_gate_config WHERE level = 'COMPANY'").get() as any).id
    const financeId = (db.prepare("SELECT id FROM human_gate_config WHERE level = 'FINANCE'").get() as any).id

    const reqResult = requestThresholdChange(db, companyId, 0.5, 0.8, 'alice@example.com', '전략 변경')
    if ('error' in reqResult) throw new Error(reqResult.error)
    approveThresholdChange(db, reqResult.eventId, 'approver@example.com', true)

    const companyGate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(companyId) as HumanGateConfigRow
    const financeGate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(financeId) as HumanGateConfigRow

    expect(companyGate.soft_threshold).toBe(0.5)
    expect(financeGate.soft_threshold).toBe(0.6)
  })

  test('게이트 비활성화가 즉시 적용된다', () => {
    seedDefaultGates()
    const gateId = (db.prepare("SELECT id FROM human_gate_config WHERE level = 'GOVERNANCE'").get() as any).id
    const now = Date.now()

    db.prepare(
      `INSERT INTO human_gate_events
         (id, gate_id, event_type, triggered_by, old_value, new_value, approved, approved_by, approved_at, rationale, created_at)
       VALUES (?, ?, 'DISABLE', ?, 'true', 'false', 1, ?, ?, NULL, ?)`
    ).run(crypto.randomUUID(), gateId, 'admin@example.com', 'admin@example.com', now, now)

    db.prepare('UPDATE human_gate_config SET enabled = 0, updated_at = ? WHERE id = ?').run(now, gateId)

    const gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId) as HumanGateConfigRow
    expect(gate.enabled).toBe(0)

    const result = requestThresholdChange(db, gateId, 0.5, 0.7, 'alice@example.com', '변경 시도')
    expect('error' in result).toBe(true)
  })

  test('복수의 임계값 변경 요청이 각각 독립된 이벤트로 기록된다', () => {
    seedDefaultGates()
    const gateId = (db.prepare("SELECT id FROM human_gate_config WHERE level = 'FINANCE'").get() as any).id

    const r1 = requestThresholdChange(db, gateId, 0.55, 0.75, 'alice@example.com', '1차 조정')
    if ('error' in r1) throw new Error(r1.error)
    approveThresholdChange(db, r1.eventId, 'approver@example.com', false, '거부')

    const r2 = requestThresholdChange(db, gateId, 0.5, 0.7, 'bob@example.com', '2차 조정')
    if ('error' in r2) throw new Error(r2.error)
    approveThresholdChange(db, r2.eventId, 'approver@example.com', true, '승인')

    const events = db.prepare('SELECT * FROM human_gate_events WHERE gate_id = ? ORDER BY created_at ASC').all(gateId) as HumanGateEventRow[]
    expect(events).toHaveLength(2)
    expect(events[0].approved).toBe(0)
    expect(events[1].approved).toBe(1)

    const gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId) as HumanGateConfigRow
    expect(gate.soft_threshold).toBe(0.5)
    expect(gate.hard_threshold).toBe(0.7)
  })
})
