import crypto from 'crypto'
import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

let db: Database.Database

function setupTestDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-ai-test-'))
  const testDb = new Database(path.join(tmpDir, 'test.db'))
  testDb.pragma('journal_mode = WAL')
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS ai_resources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      monthly_cap REAL NOT NULL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'normal',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return testDb
}

const SOFT_WARNING_THRESHOLD = 0.8
const HARD_STOP_THRESHOLD = 1.0

type CostStatus = 'normal' | 'warning' | 'hard_stop'

function resolveStatus(estimatedCost: number, monthlyCap: number): CostStatus {
  const ratio = monthlyCap > 0 ? estimatedCost / monthlyCap : 0
  if (ratio >= HARD_STOP_THRESHOLD) return 'hard_stop'
  if (ratio >= SOFT_WARNING_THRESHOLD) return 'warning'
  return 'normal'
}

function createResource(
  testDb: Database.Database,
  name: string,
  provider: string,
  monthlyCap: number
) {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO ai_resources (id, name, provider, monthly_cap, estimated_cost, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'normal', ?, ?)`
    )
    .run(id, name, provider, monthlyCap, now, now)
  return id
}

function recordUsage(
  testDb: Database.Database,
  resourceId: string,
  cost: number
): { blocked: boolean; previousStatus: CostStatus; newStatus: CostStatus; softWarning: boolean; hardStop: boolean } {
  const row = testDb.prepare('SELECT * FROM ai_resources WHERE id = ?').get(resourceId) as any
  if (!row) throw new Error('Resource not found')

  const previousStatus: CostStatus = row.status
  if (previousStatus === 'hard_stop') {
    return { blocked: true, previousStatus, newStatus: previousStatus, softWarning: false, hardStop: false }
  }

  const newCost = row.estimated_cost + cost
  const newStatus = resolveStatus(newCost, row.monthly_cap)
  const now = Date.now()
  testDb
    .prepare('UPDATE ai_resources SET estimated_cost = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(newCost, newStatus, now, resourceId)

  return {
    blocked: false,
    previousStatus,
    newStatus,
    softWarning: previousStatus === 'normal' && newStatus === 'warning',
    hardStop: previousStatus !== 'hard_stop' && newStatus === 'hard_stop',
  }
}

describe('AI Resource — status thresholds', () => {
  beforeEach(() => { db = setupTestDb() })
  afterEach(() => { db.close() })

  test('resolveStatus returns normal below 80%', () => {
    expect(resolveStatus(70, 100)).toBe('normal')
    expect(resolveStatus(0, 100)).toBe('normal')
    expect(resolveStatus(79.99, 100)).toBe('normal')
  })

  test('resolveStatus returns warning at 80%', () => {
    expect(resolveStatus(80, 100)).toBe('warning')
    expect(resolveStatus(85, 100)).toBe('warning')
    expect(resolveStatus(99.99, 100)).toBe('warning')
  })

  test('resolveStatus returns hard_stop at 100%', () => {
    expect(resolveStatus(100, 100)).toBe('hard_stop')
    expect(resolveStatus(150, 100)).toBe('hard_stop')
  })

  test('resolveStatus returns normal when monthlyCap is 0', () => {
    expect(resolveStatus(0, 0)).toBe('normal')
  })
})

describe('AI Resource — recordUsage soft warning', () => {
  beforeEach(() => { db = setupTestDb() })
  afterEach(() => { db.close() })

  test('transitions from normal to warning triggers softWarning flag', () => {
    const id = createResource(db, 'GPT-4o', 'OpenAI', 100)
    const result = recordUsage(db, id, 80)
    expect(result.blocked).toBe(false)
    expect(result.previousStatus).toBe('normal')
    expect(result.newStatus).toBe('warning')
    expect(result.softWarning).toBe(true)
    expect(result.hardStop).toBe(false)
  })

  test('warning status persists without re-triggering softWarning on subsequent usage', () => {
    const id = createResource(db, 'Claude', 'Anthropic', 100)
    recordUsage(db, id, 80)
    const result = recordUsage(db, id, 5)
    expect(result.previousStatus).toBe('warning')
    expect(result.newStatus).toBe('warning')
    expect(result.softWarning).toBe(false)
  })
})

describe('AI Resource — Hard Stop', () => {
  beforeEach(() => { db = setupTestDb() })
  afterEach(() => { db.close() })

  test('transitions to hard_stop at 100% triggers hardStop flag', () => {
    const id = createResource(db, 'Gemini', 'Google', 100)
    recordUsage(db, id, 80)
    const result = recordUsage(db, id, 20)
    expect(result.blocked).toBe(false)
    expect(result.newStatus).toBe('hard_stop')
    expect(result.hardStop).toBe(true)
  })

  test('hard_stop blocks subsequent usage calls', () => {
    const id = createResource(db, 'Llama', 'Meta', 100)
    recordUsage(db, id, 100)
    const result = recordUsage(db, id, 1)
    expect(result.blocked).toBe(true)
    const row = db.prepare('SELECT estimated_cost FROM ai_resources WHERE id = ?').get(id) as any
    expect(row.estimated_cost).toBe(100)
  })

  test('estimated_cost does not increase when hard_stop is active', () => {
    const id = createResource(db, 'Mistral', 'Mistral AI', 50)
    recordUsage(db, id, 50)
    recordUsage(db, id, 10)
    recordUsage(db, id, 10)
    const row = db.prepare('SELECT estimated_cost FROM ai_resources WHERE id = ?').get(id) as any
    expect(row.estimated_cost).toBe(50)
  })
})

describe('AI Resource — reset monthly usage', () => {
  beforeEach(() => { db = setupTestDb() })
  afterEach(() => { db.close() })

  test('resetting usage returns status to normal and cost to 0', () => {
    const id = createResource(db, 'Reset Test', 'Provider', 100)
    recordUsage(db, id, 100)
    const before = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id) as any
    expect(before.status).toBe('hard_stop')

    const now = Date.now()
    db.prepare("UPDATE ai_resources SET estimated_cost = 0, status = 'normal', updated_at = ? WHERE id = ?")
      .run(now, id)

    const after = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id) as any
    expect(after.estimated_cost).toBe(0)
    expect(after.status).toBe('normal')
  })
})

describe('AI Resource — edge cases', () => {
  beforeEach(() => { db = setupTestDb() })
  afterEach(() => { db.close() })

  test('single-step from normal to hard_stop skips warning and sets hardStop=true', () => {
    const id = createResource(db, 'BigSpend', 'Provider', 100)
    const result = recordUsage(db, id, 100)
    expect(result.newStatus).toBe('hard_stop')
    expect(result.hardStop).toBe(true)
    expect(result.softWarning).toBe(false)
  })

  test('accumulated costs across multiple small calls trigger warning correctly', () => {
    const id = createResource(db, 'Incremental', 'Provider', 100)
    for (let i = 0; i < 8; i++) {
      recordUsage(db, id, 9)
    }
    const rowBefore = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id) as any
    expect(rowBefore.status).toBe('normal')
    const result = recordUsage(db, id, 9)
    expect(result.newStatus).toBe('warning')
    expect(result.softWarning).toBe(true)
  })
})
