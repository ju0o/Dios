// ═══════════════════════════════════════════
// Agent Monitor — API 연동 사용량 추적
// ═══════════════════════════════════════════

export type AgentServiceType =
  | 'openai'
  | 'openrouter'
  | 'claude_code'
  | 'codex'
  | 'qwen_studio'
  | 'opencode'
  | 'commandcode'
  | 'goose'
  | 'hermes'

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error'

export interface AgentServiceConfig {
  id: string
  name: string
  type: AgentServiceType
  apiKey: string
  baseUrl?: string
  monthlyCap: number
  resetDay?: number // 리셋일 (기본 1일)
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface AgentUsageSnapshot {
  serviceId: string
  serviceName: string
  type: AgentServiceType
  used: number          // 현재 사용량 (dollars or credits)
  limit: number         // 한도
  remaining: number     // 잔여
  percent: number       // 사용률 %
  resetAt: number       // 리셋 시각 (timestamp)
  currency: string      // 'USD' | 'credits' | 'tokens'
  status: FetchStatus
  error?: string
  fetchedAt: number     // 마지막 조회 시각
  // 세부 정보
  daily?: number
  weekly?: number
  monthly?: number
}

export interface AgentPetState {
  mood: 'happy' | 'running' | 'sweating' | 'panicking' | 'collapsed' | 'celebrating'
  speed: number         // 애니메이션 속도
  message: string       // 말풍선
}

export interface AgentMonitorState {
  snapshots: AgentUsageSnapshot[]
  petState: AgentPetState
  lastRefresh: number
  skillCount: number
  mdFileCount: number
}
