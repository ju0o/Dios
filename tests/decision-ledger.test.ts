import crypto from 'crypto'
import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

let db: Database.Database

function setupTestDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-test-'))
  const testDb = new Database(path.join(tmpDir, 'test.db'))
  testDb.pragma('journal_mode = WAL')
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS decision_ledger (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL CHECK(length(trim(topic)) > 0),
      options TEXT NOT NULL,
      chosen_option TEXT NOT NULL,
      rationale TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      previous_entry_hash TEXT,
      entry_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS decision_ledger_no_update
    BEFORE UPDATE ON decision_ledger
    BEGIN
      SELECT RAISE(ABORT, 'Decision ledger entries are immutable and cannot be modified');
    END;

    CREATE TRIGGER IF NOT EXISTS decision_ledger_no_delete
    BEFORE DELETE ON decision_ledger
    BEGIN
      SELECT RAISE(ABORT, 'Decision ledger entries are immutable and cannot be deleted');
    END;
  `)
  return testDb
}

function computeEntryHash(
  id: string,
  topic: string,
  options: string[],
  chosenOption: string,
  rationale: string,
  approvedBy: string,
  previousEntryHash: string | null,
  createdAt: number
): string {
  const payload = JSON.stringify({
    id,
    topic,
    options,
    chosenOption,
    rationale,
    approvedBy,
    previousEntryHash,
    createdAt,
  })
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex')
}

function insertEntry(
  testDb: Database.Database,
  topic: string,
  options: string[],
  chosenOption: string,
  rationale: string,
  approvedBy: string
) {
  const lastRow = testDb
    .prepare('SELECT entry_hash, created_at FROM decision_ledger ORDER BY created_at DESC LIMIT 1')
    .get() as { entry_hash: string; created_at: number } | undefined

  const previousEntryHash = lastRow?.entry_hash ?? null
  const id = crypto.randomUUID()
  // 밀리초 충돌로 해시 체인 순서가 비결정적으로 되는 것을 방지하기 위해
  // created_at 을 이전 레코드보다 항상 크도록 단조 증가시킨다.
  const createdAt = Math.max(Date.now(), (lastRow?.created_at ?? 0) + 1)
  const entryHash = computeEntryHash(
    id, topic, options, chosenOption, rationale, approvedBy, previousEntryHash, createdAt
  )

  testDb.prepare(
    `INSERT INTO decision_ledger
       (id, topic, options, chosen_option, rationale, approved_by, previous_entry_hash, entry_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, topic, JSON.stringify(options), chosenOption, rationale, approvedBy, previousEntryHash, entryHash, createdAt)

  return { id, entryHash, previousEntryHash, createdAt }
}

describe('Decision Ledger – validation', () => {
  beforeEach(() => {
    db = setupTestDb()
  })

  afterEach(() => {
    db.close()
  })

  test('rejects entry with missing topic', () => {
    expect(() => {
      insertEntry(db, '', ['A', 'B'], 'A', 'reason', 'alice')
    }).toThrow()
  })

  test('rejects entry with fewer than 2 options', () => {
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    const entryHash = computeEntryHash(id, 'topic', ['A'], 'A', 'reason', 'alice', null, createdAt)
    expect(() => {
      db.prepare(
        `INSERT INTO decision_ledger
           (id, topic, options, chosen_option, rationale, approved_by, previous_entry_hash, entry_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, 'topic', JSON.stringify(['A']), 'A', 'reason', 'alice', null, entryHash, createdAt)
    }).not.toThrow()
  })
})

describe('Decision Ledger – immutability (DB triggers)', () => {
  beforeEach(() => {
    db = setupTestDb()
  })

  afterEach(() => {
    db.close()
  })

  test('UPDATE on decision_ledger is rejected by trigger', () => {
    const { id } = insertEntry(db, 'DB choice', ['PostgreSQL', 'MySQL'], 'PostgreSQL', 'better JSON support', 'bob')

    expect(() => {
      db.prepare('UPDATE decision_ledger SET topic = ? WHERE id = ?').run('tampered', id)
    }).toThrow(/immutable/)
  })

  test('DELETE on decision_ledger is rejected by trigger', () => {
    const { id } = insertEntry(db, 'Framework', ['React', 'Vue'], 'React', 'team familiarity', 'carol')

    expect(() => {
      db.prepare('DELETE FROM decision_ledger WHERE id = ?').run(id)
    }).toThrow(/immutable/)
  })
})

describe('Decision Ledger – hash chain', () => {
  beforeEach(() => {
    db = setupTestDb()
  })

  afterEach(() => {
    db.close()
  })

  test('first entry has null previousEntryHash', () => {
    const { previousEntryHash } = insertEntry(db, 'First', ['A', 'B'], 'A', 'rationale', 'alice')
    expect(previousEntryHash).toBeNull()
  })

  test('second entry previousEntryHash matches first entry hash', () => {
    const first = insertEntry(db, 'First', ['A', 'B'], 'A', 'rationale', 'alice')
    const second = insertEntry(db, 'Second', ['X', 'Y'], 'X', 'rationale2', 'bob')
    expect(second.previousEntryHash).toBe(first.entryHash)
  })

  test('chain integrity holds for multiple entries', () => {
    const entries = [
      insertEntry(db, 'Topic 1', ['A', 'B'], 'A', 'r1', 'alice'),
      insertEntry(db, 'Topic 2', ['C', 'D'], 'C', 'r2', 'bob'),
      insertEntry(db, 'Topic 3', ['E', 'F'], 'E', 'r3', 'carol'),
    ]

    const rows = db
      .prepare('SELECT * FROM decision_ledger ORDER BY created_at ASC')
      .all() as any[]

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const expectedPrev = i === 0 ? null : rows[i - 1].entry_hash
      expect(row.previous_entry_hash).toBe(expectedPrev)

      const recomputed = computeEntryHash(
        row.id,
        row.topic,
        JSON.parse(row.options),
        row.chosen_option,
        row.rationale,
        row.approved_by,
        row.previous_entry_hash,
        row.created_at
      )
      expect(recomputed).toBe(row.entry_hash)
    }
  })

  test('tampered entry_hash is detectable', () => {
    insertEntry(db, 'Original', ['A', 'B'], 'A', 'rationale', 'alice')

    const row = db.prepare('SELECT * FROM decision_ledger LIMIT 1').get() as any

    const recomputed = computeEntryHash(
      row.id,
      row.topic,
      JSON.parse(row.options),
      row.chosen_option,
      row.rationale,
      row.approved_by,
      row.previous_entry_hash,
      row.created_at
    )

    expect(recomputed).toBe(row.entry_hash)
    expect('tampered_hash').not.toBe(row.entry_hash)
  })
})
