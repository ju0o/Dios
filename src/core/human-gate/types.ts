export type HumanGateLevel = 'COMPANY' | 'FINANCE' | 'AI_RESOURCE' | 'GOVERNANCE'

export interface HumanGateConfig {
  id: string
  level: HumanGateLevel
  name: string
  description: string
  softThreshold: number
  hardThreshold: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface HumanGateEvent {
  id: string
  gateId: string
  eventType: 'THRESHOLD_CHANGE' | 'ENABLE' | 'DISABLE' | 'GATE_TRIGGERED'
  triggeredBy: string
  oldValue: string | null
  newValue: string | null
  approved: boolean | null
  approvedBy: string | null
  approvedAt: number | null
  rationale: string | null
  createdAt: number
}

export interface CreateHumanGateInput {
  level: HumanGateLevel
  name: string
  description: string
  softThreshold: number
  hardThreshold: number
}

export interface UpdateThresholdInput {
  gateId: string
  softThreshold: number
  hardThreshold: number
  requestedBy: string
  rationale: string
}

export interface ApproveThresholdChangeInput {
  eventId: string
  approvedBy: string
  approved: boolean
  rationale?: string
}

export type HumanGateResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface ThresholdChangeResult {
  event: HumanGateEvent
  gateTriggered: boolean
  pendingApproval: boolean
}

export const DEFAULT_GATES: CreateHumanGateInput[] = [
  {
    level: 'COMPANY',
    name: '회사 수준 게이트',
    description: '회사 전략·정책에 영향을 미치는 결정에 대한 Human Gate',
    softThreshold: 0.7,
    hardThreshold: 0.9,
  },
  {
    level: 'FINANCE',
    name: '재무 수준 게이트',
    description: '재무·예산에 영향을 미치는 결정에 대한 Human Gate',
    softThreshold: 0.6,
    hardThreshold: 0.8,
  },
  {
    level: 'AI_RESOURCE',
    name: 'AI 리소스 수준 게이트',
    description: 'AI 리소스 할당·비용 한도 변경에 대한 Human Gate',
    softThreshold: 0.5,
    hardThreshold: 0.75,
  },
  {
    level: 'GOVERNANCE',
    name: '거버넌스 수준 게이트',
    description: '거버넌스·컴플라이언스 규칙 변경에 대한 Human Gate',
    softThreshold: 0.8,
    hardThreshold: 1.0,
  },
]
