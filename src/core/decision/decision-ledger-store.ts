import crypto from 'crypto'
import { getDatabase } from '../../../electron/db/schema'
import type {
  CreateDecisionInput,
  DecisionLedgerEntry,
  DecisionLedgerResponse,
} from './types'

interface DecisionLedgerRow {
  id: string
  topic: string
  options: string
  chosen_option: string
  rationale: string
  approved_by: string
  previous_entry_hash: string | null
  entry_hash: string
  created_at: number
}

function validateInput(input: CreateDecisionInput): string | null {
  if (!input.topic || input.topic.trim() === '') {
    return 'topic is required'
  }
  if (!Array.isArray(input.options) || input.options.length < 2) {
    return 'options must contain at least 2 items'
  }
  if (input.options.some((o) => !o || o.trim() === '')) {
    return 'all options must be non-empty strings'
  }
  if (!input.chosenOption || input.chosenOption.trim() === '') {
    return 'chosenOption is required'
  }
  if (!input.options.includes(input.chosenOption)) {
    return 'chosenOption must be one of the provided options'
  }
  if (!input.rationale || input.rationale.trim() === '') {
    return 'rationale is required'
  }
  if (!input.approvedBy || input.approvedBy.trim() === '') {
    return 'approvedBy is required'
  }
  return null
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

function rowToEntry(row: DecisionLedgerRow): DecisionLedgerEntry {
  return {
    id: row.id,
    topic: row.topic,
    options: JSON.parse(row.options) as string[],
    chosenOption: row.chosen_option,
    rationale: row.rationale,
    approvedBy: row.approved_by,
    previousEntryHash: row.previous_entry_hash,
    entryHash: row.entry_hash,
    createdAt: row.created_at,
  }
}

export function createDecisionEntry(
  input: CreateDecisionInput
): DecisionLedgerResponse {
  const validationError = validateInput(input)
  if (validationError) {
    return { success: false, error: validationError }
  }

  const db = getDatabase()

  const lastRow = db
    .prepare(
      'SELECT entry_hash FROM decision_ledger ORDER BY created_at DESC, id DESC LIMIT 1'
    )
    .get() as { entry_hash: string } | undefined

  const previousEntryHash = lastRow?.entry_hash ?? null
  const id = crypto.randomUUID()
  const createdAt = Date.now()

  const entryHash = computeEntryHash(
    id,
    input.topic,
    input.options,
    input.chosenOption,
    input.rationale,
    input.approvedBy,
    previousEntryHash,
    createdAt
  )

  db.prepare(
    `INSERT INTO decision_ledger
       (id, topic, options, chosen_option, rationale, approved_by, previous_entry_hash, entry_hash, created_at)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.topic,
    JSON.stringify(input.options),
    input.chosenOption,
    input.rationale,
    input.approvedBy,
    previousEntryHash,
    entryHash,
    createdAt
  )

  const entry: DecisionLedgerEntry = {
    id,
    topic: input.topic,
    options: input.options,
    chosenOption: input.chosenOption,
    rationale: input.rationale,
    approvedBy: input.approvedBy,
    previousEntryHash,
    entryHash,
    createdAt,
  }

  return { success: true, entry }
}

export function listDecisionEntries(): DecisionLedgerEntry[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM decision_ledger ORDER BY created_at ASC, id ASC')
    .all() as DecisionLedgerRow[]
  return rows.map(rowToEntry)
}

export function getDecisionEntry(id: string): DecisionLedgerEntry | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM decision_ledger WHERE id = ?')
    .get(id) as DecisionLedgerRow | undefined
  return row ? rowToEntry(row) : null
}

export function verifyChainIntegrity(): { valid: boolean; brokenAt?: string } {
  const entries = listDecisionEntries()

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const expectedPreviousHash = i === 0 ? null : entries[i - 1].entryHash

    if (entry.previousEntryHash !== expectedPreviousHash) {
      return { valid: false, brokenAt: entry.id }
    }

    const recomputed = computeEntryHash(
      entry.id,
      entry.topic,
      entry.options,
      entry.chosenOption,
      entry.rationale,
      entry.approvedBy,
      entry.previousEntryHash,
      entry.createdAt
    )

    if (recomputed !== entry.entryHash) {
      return { valid: false, brokenAt: entry.id }
    }
  }

  return { valid: true }
}
