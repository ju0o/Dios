import crypto from 'crypto'
import { getDatabase } from '../../../electron/db/schema'
import type {
  ActorRole,
  CreateExperimentInput,
  Experiment,
  ExperimentResponse,
  ExperimentState,
  ExperimentTransition,
  TransitionInput,
} from './types'
import { VALID_TRANSITIONS, requiresCeoApproval } from './types'

interface ExperimentRow {
  id: string
  name: string
  description: string
  state: string
  created_by: string
  approved_by: string | null
  approved_at: number | null
  created_at: number
  updated_at: number
}

interface TransitionRow {
  id: string
  experiment_id: string
  from_state: string
  to_state: string
  triggered_by: string
  role: string
  rationale: string | null
  created_at: number
}

function rowToExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    state: row.state as ExperimentState,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToTransition(row: TransitionRow): ExperimentTransition {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    fromState: row.from_state as ExperimentState,
    toState: row.to_state as ExperimentState,
    triggeredBy: row.triggered_by,
    role: row.role as ActorRole,
    rationale: row.rationale,
    createdAt: row.created_at,
  }
}

export function createExperiment(
  input: CreateExperimentInput
): ExperimentResponse<Experiment> {
  if (!input.name.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'name은 필수입니다.' } }
  }
  if (!input.createdBy.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'createdBy는 필수입니다.' } }
  }

  try {
    const db = getDatabase()
    const id = crypto.randomUUID()
    const now = Date.now()

    db.prepare(
      `INSERT INTO experiments
         (id, name, description, state, created_by, approved_by, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, 'DRAFT', ?, NULL, NULL, ?, ?)`
    ).run(id, input.name.trim(), input.description.trim(), input.createdBy.trim(), now, now)

    const row = db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as ExperimentRow
    return { ok: true, data: rowToExperiment(row) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function getExperiment(id: string): ExperimentResponse<Experiment> {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as ExperimentRow | undefined
    if (!row) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `실험 ${id}를 찾을 수 없습니다.` } }
    }
    return { ok: true, data: rowToExperiment(row) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function listExperiments(): ExperimentResponse<Experiment[]> {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM experiments ORDER BY created_at DESC').all() as ExperimentRow[]
    return { ok: true, data: rows.map(rowToExperiment) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function transitionExperiment(
  input: TransitionInput
): ExperimentResponse<{ experiment: Experiment; transition: ExperimentTransition }> {
  if (!input.triggeredBy.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'triggeredBy는 필수입니다.' } }
  }

  try {
    const db = getDatabase()
    const expRow = db.prepare('SELECT * FROM experiments WHERE id = ?').get(input.experimentId) as ExperimentRow | undefined
    if (!expRow) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `실험 ${input.experimentId}를 찾을 수 없습니다.` } }
    }

    const currentState = expRow.state as ExperimentState
    const allowed = VALID_TRANSITIONS[currentState]

    if (!allowed.includes(input.toState)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `${currentState} → ${input.toState} 전이는 허용되지 않습니다.`,
        },
      }
    }

    if (requiresCeoApproval(input.toState) && input.role !== 'CEO') {
      return {
        ok: false,
        error: {
          code: 'CEO_APPROVAL_REQUIRED',
          message: `${input.toState} 전이는 CEO 승인이 필요합니다. Hermes-B 단독으로 실행할 수 없습니다.`,
        },
      }
    }

    const now = Date.now()
    const transitionId = crypto.randomUUID()
    const approvedBy = requiresCeoApproval(input.toState) ? input.triggeredBy : null
    const approvedAt = requiresCeoApproval(input.toState) ? now : null

    db.prepare(
      `UPDATE experiments SET state = ?, approved_by = COALESCE(?, approved_by), approved_at = COALESCE(?, approved_at), updated_at = ? WHERE id = ?`
    ).run(input.toState, approvedBy, approvedAt, now, input.experimentId)

    db.prepare(
      `INSERT INTO experiment_transitions
         (id, experiment_id, from_state, to_state, triggered_by, role, rationale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      transitionId, input.experimentId, currentState, input.toState,
      input.triggeredBy.trim(), input.role, input.rationale ?? null, now
    )

    const updatedRow = db.prepare('SELECT * FROM experiments WHERE id = ?').get(input.experimentId) as ExperimentRow
    const transitionRow = db.prepare('SELECT * FROM experiment_transitions WHERE id = ?').get(transitionId) as TransitionRow

    return {
      ok: true,
      data: {
        experiment: rowToExperiment(updatedRow),
        transition: rowToTransition(transitionRow),
      },
    }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}

export function listTransitions(experimentId: string): ExperimentResponse<ExperimentTransition[]> {
  try {
    const db = getDatabase()
    const rows = db.prepare(
      'SELECT * FROM experiment_transitions WHERE experiment_id = ? ORDER BY created_at ASC'
    ).all(experimentId) as TransitionRow[]
    return { ok: true, data: rows.map(rowToTransition) }
  } catch (err) {
    return { ok: false, error: { code: 'DB_ERROR', message: String(err) } }
  }
}
