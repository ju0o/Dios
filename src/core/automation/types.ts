export type ExecutionClass = 'AUTONOMOUS' | 'HUMAN_GATE_REQUIRED'

export type AuditStatus =
  | 'EXECUTED'
  | 'BLOCKED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'

export type AutonomousActionType =
  | 'SIGNAL_COLLECT'
  | 'SIGNAL_SCORE'
  | 'REPORT_GENERATE'
  | 'LOOP_HEARTBEAT'
  | 'EXPERIMENT_DRAFT_CREATE'
  | 'EXPERIMENT_HYPOTHESIS_ADVANCE'

export type HumanGateActionType =
  | 'BUSINESS_CREATE'
  | 'BUDGET_CHANGE'
  | 'ORDER_PLACE'
  | 'DELIVERY_ACCEPT'
  | 'BUSINESS_TERMINATE'
  | 'EXPERIMENT_VALIDATE'
  | 'EXPERIMENT_APPROVE'
  | 'EXPERIMENT_RUN'
  | 'EXPERIMENT_SCALE'
  | 'EXPERIMENT_PIVOT'
  | 'EXPERIMENT_HOLD'
  | 'EXPERIMENT_TERMINATE'
  | 'COMPANY_DELETE'
  | 'PERMANENT_TERMINATE'
  | 'HIGH_COST_ORDER'
  | 'SUBSCRIPTION_CANCEL'
  | 'MODEL_REPLACE'
  | 'CONSTITUTION_CHANGE'
  | 'PAYMENT_EXECUTE'
  | 'LEGAL_CONTRACT'
  | 'PII_TRANSFER'
  | 'AUTOMATION_EXPAND'
  | 'AI_EMPLOYEE_TERMINATE'

export type ActionType = AutonomousActionType | HumanGateActionType

export interface AuditLogEntry {
  id: string
  actor: string
  actionType: ActionType
  executionClass: ExecutionClass
  status: AuditStatus
  payload: Record<string, unknown> | null
  rationale: string | null
  gateEventId: string | null
  createdAt: number
}

export interface RecordAuditInput {
  actor: string
  actionType: ActionType
  executionClass: ExecutionClass
  status: AuditStatus
  payload?: Record<string, unknown>
  rationale?: string
  gateEventId?: string
}

export interface ExecuteAutonomousInput<T extends Record<string, unknown> = Record<string, unknown>> {
  actor: string
  actionType: AutonomousActionType
  payload?: T
  rationale?: string
}

export interface RequestHumanGateInput<T extends Record<string, unknown> = Record<string, unknown>> {
  actor: string
  actionType: HumanGateActionType
  payload?: T
  rationale: string
}

export type BoundaryResponse<T = void> =
  | { ok: true; data: T; auditId: string }
  | { ok: false; error: { code: string; message: string }; auditId: string }

export const AUTONOMOUS_ACTIONS: Set<ActionType> = new Set<AutonomousActionType>([
  'SIGNAL_COLLECT',
  'SIGNAL_SCORE',
  'REPORT_GENERATE',
  'LOOP_HEARTBEAT',
  'EXPERIMENT_DRAFT_CREATE',
  'EXPERIMENT_HYPOTHESIS_ADVANCE',
])

export const HUMAN_GATE_ACTIONS: Set<ActionType> = new Set<HumanGateActionType>([
  'BUSINESS_CREATE',
  'BUDGET_CHANGE',
  'ORDER_PLACE',
  'DELIVERY_ACCEPT',
  'BUSINESS_TERMINATE',
  'EXPERIMENT_VALIDATE',
  'EXPERIMENT_APPROVE',
  'EXPERIMENT_RUN',
  'EXPERIMENT_SCALE',
  'EXPERIMENT_PIVOT',
  'EXPERIMENT_HOLD',
  'EXPERIMENT_TERMINATE',
  'COMPANY_DELETE',
  'PERMANENT_TERMINATE',
  'HIGH_COST_ORDER',
  'SUBSCRIPTION_CANCEL',
  'MODEL_REPLACE',
  'CONSTITUTION_CHANGE',
  'PAYMENT_EXECUTE',
  'LEGAL_CONTRACT',
  'PII_TRANSFER',
  'AUTOMATION_EXPAND',
  'AI_EMPLOYEE_TERMINATE',
])

export function classifyAction(actionType: ActionType): ExecutionClass {
  if (AUTONOMOUS_ACTIONS.has(actionType)) return 'AUTONOMOUS'
  return 'HUMAN_GATE_REQUIRED'
}
