export type CostStatus = 'normal' | 'warning' | 'hard_stop'

export interface AIResource {
  id: string
  name: string
  provider: string
  monthlyCap: number
  estimatedCost: number
  status: CostStatus
  createdAt: number
  updatedAt: number
}

export interface CreateAIResourceInput {
  name: string
  provider: string
  monthlyCap: number
}

export interface RecordUsageInput {
  resourceId: string
  cost: number
}

export interface UsageRecordedResult {
  resource: AIResource
  previousStatus: CostStatus
  newStatus: CostStatus
  softWarningTriggered: boolean
  hardStopTriggered: boolean
}

export interface AIResourceError {
  code:
    | 'RESOURCE_NOT_FOUND'
    | 'HARD_STOP_ACTIVE'
    | 'INVALID_INPUT'
    | 'DB_ERROR'
  message: string
  resourceId?: string
}

export type AIResourceResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: AIResourceError }
