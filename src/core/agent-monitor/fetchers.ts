// ═══════════════════════════════════════════
// Agent Monitor — API Fetchers
// 각 서비스별 사용량 조회 로직
// ═══════════════════════════════════════════

import type { AgentUsageSnapshot, AgentServiceConfig } from './types'

// ─── OpenAI ───────────────────────────────
export async function fetchOpenAIUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1'
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  }

  try {
    // Billing usage endpoint
    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    const usageRes = await fetch(
      `${baseUrl}/usage?start_date=${Math.floor(startDate.getTime() / 1000)}&end_date=${Math.floor(endDate.getTime() / 1000)}`,
      { headers }
    )

    if (!usageRes.ok) {
      throw new Error(`OpenAI API error: ${usageRes.status}`)
    }

    const usageData = await usageRes.json() as any
    const totalUsed = (usageData.total_usage || 0) / 100 // cents → dollars

    // Credit grants
    const creditRes = await fetch(`${baseUrl}/dashboard/billing/credit_grants`, { headers })
    let totalLimit = config.monthlyCap
    if (creditRes.ok) {
      const creditData = await creditRes.json() as any
      totalLimit = creditData.total_granted || config.monthlyCap
    }

    const remaining = Math.max(0, totalLimit - totalUsed)
    const percent = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0

    // Reset: end of current month
    const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()

    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'openai',
      used: totalUsed,
      limit: totalLimit,
      remaining,
      percent,
      resetAt,
      currency: 'USD',
      status: 'success',
      fetchedAt: Date.now(),
    }
  } catch (err: any) {
    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'openai',
      used: 0,
      limit: config.monthlyCap,
      remaining: config.monthlyCap,
      percent: 0,
      resetAt: 0,
      currency: 'USD',
      status: 'error',
      error: err.message || 'Failed to fetch',
      fetchedAt: Date.now(),
    }
  }
}

// ─── OpenRouter ───────────────────────────
export async function fetchOpenRouterUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1'
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  }

  try {
    const res = await fetch(`${baseUrl}/auth/key`, { headers })
    if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`)

    const data = await res.json() as any
    const keyData = data.data || data

    const limit = keyData.limit ?? config.monthlyCap
    const remaining = keyData.limit_remaining ?? limit
    const used = limit - remaining
    const percent = limit > 0 ? (used / limit) * 100 : 0

    // Reset time
    let resetAt = 0
    if (keyData.limit_reset === 'daily') {
      const now = new Date()
      resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    } else if (keyData.limit_reset === 'weekly') {
      const now = new Date()
      const dayOfWeek = now.getDay()
      const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
      resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday).getTime()
    } else if (keyData.limit_reset === 'monthly') {
      const now = new Date()
      resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
    }

    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'openrouter',
      used,
      limit,
      remaining,
      percent,
      resetAt,
      currency: 'USD',
      status: 'success',
      fetchedAt: Date.now(),
      daily: keyData.usage_daily || 0,
      weekly: keyData.usage_weekly || 0,
      monthly: keyData.usage_monthly || 0,
    }
  } catch (err: any) {
    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'openrouter',
      used: 0,
      limit: config.monthlyCap,
      remaining: config.monthlyCap,
      percent: 0,
      resetAt: 0,
      currency: 'USD',
      status: 'error',
      error: err.message || 'Failed to fetch',
      fetchedAt: Date.now(),
    }
  }
}

// ─── CommandCode ──────────────────────────
export async function fetchCommandCodeUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  const baseUrl = config.baseUrl || 'https://api.commandcode.ai/v1'
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  }

  try {
    // CommandCode는 OpenAI 호환 API 사용
    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    const usageRes = await fetch(
      `${baseUrl}/usage?start_date=${Math.floor(startDate.getTime() / 1000)}&end_date=${Math.floor(endDate.getTime() / 1000)}`,
      { headers }
    )

    if (!usageRes.ok) {
      throw new Error(`CommandCode API error: ${usageRes.status}`)
    }

    const usageData = await usageRes.json() as any
    const totalUsed = (usageData.total_usage || 0) / 100

    const remaining = Math.max(0, config.monthlyCap - totalUsed)
    const percent = config.monthlyCap > 0 ? (totalUsed / config.monthlyCap) * 100 : 0
    const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()

    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'commandcode',
      used: totalUsed,
      limit: config.monthlyCap,
      remaining,
      percent,
      resetAt,
      currency: 'USD',
      status: 'success',
      fetchedAt: Date.now(),
    }
  } catch (err: any) {
    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'commandcode',
      used: 0,
      limit: config.monthlyCap,
      remaining: config.monthlyCap,
      percent: 0,
      resetAt: 0,
      currency: 'USD',
      status: 'error',
      error: err.message || 'Failed to fetch',
      fetchedAt: Date.now(),
    }
  }
}

// ─── OpenCode ─────────────────────────────
export async function fetchOpenCodeUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  // OpenCode는 콘솔 기반 추적 (API 불명확)
  const now = new Date()
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()

  return {
    serviceId: config.id,
    serviceName: config.name,
    type: 'opencode',
    used: 0,
    limit: config.monthlyCap,
    remaining: config.monthlyCap,
    percent: 0,
    resetAt,
    currency: 'USD',
    status: 'idle',
    error: 'OpenCode는 콘솔에서 수동 추적 (https://opencode.ai/auth)',
    fetchedAt: Date.now(),
  }
}

// ─── Qwen Studio (DashScope) ──────────────
export async function fetchQwenStudioUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  }

  try {
    // DashScope는 토큰 사용량 API 제공
    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    const usageRes = await fetch(
      `${baseUrl}/usage?start_date=${Math.floor(startDate.getTime() / 1000)}&end_date=${Math.floor(endDate.getTime() / 1000)}`,
      { headers }
    )

    if (!usageRes.ok) {
      throw new Error(`Qwen Studio API error: ${usageRes.status}`)
    }

    const usageData = await usageRes.json() as any
    const totalUsed = (usageData.total_usage || 0) / 100

    const remaining = Math.max(0, config.monthlyCap - totalUsed)
    const percent = config.monthlyCap > 0 ? (totalUsed / config.monthlyCap) * 100 : 0
    const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()

    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'qwen_studio',
      used: totalUsed,
      limit: config.monthlyCap,
      remaining,
      percent,
      resetAt,
      currency: 'USD',
      status: 'success',
      fetchedAt: Date.now(),
    }
  } catch (err: any) {
    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'qwen_studio',
      used: 0,
      limit: config.monthlyCap,
      remaining: config.monthlyCap,
      percent: 0,
      resetAt: 0,
      currency: 'USD',
      status: 'error',
      error: err.message || 'Failed to fetch',
      fetchedAt: Date.now(),
    }
  }
}

// ─── Codex (구독형 - 세션 로그 파싱) ────────
export async function fetchCodexSubscriptionUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  // Codex는 ChatGPT Plus/Pro 구독 기반
  // 로컬 세션 로그를 파싱해서 사용량 추적
  const fs = require('fs')
  const path = require('path')
  const os = require('os')

  try {
    // Codex 세션 로그 경로 (예시)
    const codexLogPath = path.join(os.homedir(), '.codex', 'sessions')
    let totalUsed = 0

    if (fs.existsSync(codexLogPath)) {
      const files = fs.readdirSync(codexLogPath)
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

      for (const file of files) {
        const filePath = path.join(codexLogPath, file)
        const stat = fs.statSync(filePath)
        
        // 이번 달 파일만
        if (stat.mtime >= monthStart) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8')
            const session = JSON.parse(content)
            
            // 토큰 사용량 집계 (예시 로직)
            if (session.usage) {
              totalUsed += session.usage.total_tokens || 0
            }
          } catch {
            // 파싱 실패 시 무시
          }
        }
      }
    }

    // 토큰을 달러로 변환 (대략적 추정)
    const estimatedCost = totalUsed * 0.00001 // $0.01 per 1K tokens 가정
    const remaining = Math.max(0, config.monthlyCap - estimatedCost)
    const percent = config.monthlyCap > 0 ? (estimatedCost / config.monthlyCap) * 100 : 0
    const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()

    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'codex',
      used: estimatedCost,
      limit: config.monthlyCap,
      remaining,
      percent,
      resetAt,
      currency: 'USD',
      status: 'success',
      fetchedAt: Date.now(),
      monthly: estimatedCost,
    }
  } catch (err: any) {
    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'codex',
      used: 0,
      limit: config.monthlyCap,
      remaining: config.monthlyCap,
      percent: 0,
      resetAt: 0,
      currency: 'USD',
      status: 'error',
      error: err.message || '세션 로그를 찾을 수 없습니다',
      fetchedAt: Date.now(),
    }
  }
}

// ─── Claude Code (구독형 - 세션 로그 파싱) ──
export async function fetchClaudeCodeSubscriptionUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  // Claude Code는 Claude Pro/Max 구독 기반
  // 로컬 세션 로그를 파싱해서 사용량 추적
  const fs = require('fs')
  const path = require('path')
  const os = require('os')

  try {
    // Claude Code 세션 로그 경로 (예시)
    const claudeLogPath = path.join(os.homedir(), '.claude', 'sessions')
    let totalUsed = 0

    if (fs.existsSync(claudeLogPath)) {
      const files = fs.readdirSync(claudeLogPath)
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

      for (const file of files) {
        const filePath = path.join(claudeLogPath, file)
        const stat = fs.statSync(filePath)
        
        // 이번 달 파일만
        if (stat.mtime >= monthStart) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8')
            const session = JSON.parse(content)
            
            // 토큰 사용량 집계 (예시 로직)
            if (session.usage) {
              totalUsed += session.usage.total_tokens || 0
            }
          } catch {
            // 파싱 실패 시 무시
          }
        }
      }
    }

    // 토큰을 달러로 변환 (대략적 추정)
    const estimatedCost = totalUsed * 0.00001 // $0.01 per 1K tokens 가정
    const remaining = Math.max(0, config.monthlyCap - estimatedCost)
    const percent = config.monthlyCap > 0 ? (estimatedCost / config.monthlyCap) * 100 : 0
    const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()

    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'claude_code',
      used: estimatedCost,
      limit: config.monthlyCap,
      remaining,
      percent,
      resetAt,
      currency: 'USD',
      status: 'success',
      fetchedAt: Date.now(),
      monthly: estimatedCost,
    }
  } catch (err: any) {
    return {
      serviceId: config.id,
      serviceName: config.name,
      type: 'claude_code',
      used: 0,
      limit: config.monthlyCap,
      remaining: config.monthlyCap,
      percent: 0,
      resetAt: 0,
      currency: 'USD',
      status: 'error',
      error: err.message || '세션 로그를 찾을 수 없습니다',
      fetchedAt: Date.now(),
    }
  }
}

// ─── Generic fetcher (fallback) ───────────
export async function fetchGenericUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  // For services without API: return manual tracking data
  return {
    serviceId: config.id,
    serviceName: config.name,
    type: config.type,
    used: 0,
    limit: config.monthlyCap,
    remaining: config.monthlyCap,
    percent: 0,
    resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getTime(),
    currency: 'USD',
    status: 'idle',
    error: 'API 연동 미지원 — 수동 추적 모드',
    fetchedAt: Date.now(),
  }
}

// ─── Dispatcher ───────────────────────────
export async function fetchUsage(config: AgentServiceConfig): Promise<AgentUsageSnapshot> {
  switch (config.type) {
    case 'openai':
      return fetchOpenAIUsage(config)
    case 'codex':
      return fetchCodexSubscriptionUsage(config)
    case 'claude_code':
      return fetchClaudeCodeSubscriptionUsage(config)
    case 'openrouter':
    case 'goose':
      return fetchOpenRouterUsage(config)
    case 'commandcode':
      return fetchCommandCodeUsage(config)
    case 'opencode':
      return fetchOpenCodeUsage(config)
    case 'qwen_studio':
      return fetchQwenStudioUsage(config)
    default:
      return fetchGenericUsage(config)
  }
}
