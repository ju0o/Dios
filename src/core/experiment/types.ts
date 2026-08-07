export type ExperimentState =
  | 'DRAFT'
  | 'HYPOTHESIS'
  | 'VALIDATION'
  | 'APPROVED'
  | 'RUNNING'
  | 'SCALE'
  | 'PIVOT'
  | 'HOLD'
  | 'TERMINATED'

export type ActorRole = 'HERMES_B' | 'CEO' | 'SYSTEM'

export interface Experiment {
  id: string
  name: string
  description: string
  state: ExperimentState
  createdBy: string
  approvedBy: string | null
  approvedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ExperimentTransition {
  id: string
  experimentId: string
  fromState: ExperimentState
  toState: ExperimentState
  triggeredBy: string
  role: ActorRole
  rationale: string | null
  createdAt: number
}

export interface CreateExperimentInput {
  name: string
  description: string
  createdBy: string
}

export interface TransitionInput {
  experimentId: string
  toState: ExperimentState
  triggeredBy: string
  role: ActorRole
  rationale?: string
}

export type ExperimentResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

const CEO_REQUIRED_TARGETS: ExperimentState[] = [
  'VALIDATION',
  'APPROVED',
  'RUNNING',
  'SCALE',
  'PIVOT',
  'HOLD',
  'TERMINATED',
]

export const VALID_TRANSITIONS: Record<ExperimentState, ExperimentState[]> = {
  DRAFT: ['HYPOTHESIS'],
  HYPOTHESIS: ['VALIDATION', 'TERMINATED'],
  VALIDATION: ['APPROVED', 'PIVOT', 'TERMINATED'],
  APPROVED: ['RUNNING', 'HOLD', 'TERMINATED'],
  RUNNING: ['SCALE', 'PIVOT', 'HOLD', 'TERMINATED'],
  SCALE: ['HOLD', 'TERMINATED'],
  PIVOT: ['HYPOTHESIS', 'TERMINATED'],
  HOLD: ['RUNNING', 'TERMINATED'],
  TERMINATED: [],
}

export function requiresCeoApproval(toState: ExperimentState): boolean {
  return CEO_REQUIRED_TARGETS.includes(toState)
}
