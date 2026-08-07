// ═══════════════════════════════════════════
// Agent Monitor — Store (SQLite-backed)
// ═══════════════════════════════════════════

import crypto from 'crypto'
import { getDatabase } from '../../../electron/db/schema'
import type { AgentServiceConfig, AgentUsageSnapshot, AgentPetState } from './types'
import { fetchUsage } from './fetchers'

interface ServiceRow {
  id: string
  name: string
  type: string
  api_key: string
  base_url: string
  monthly_cap: number
  reset_day: number
  enabled: number
  created_at: number
  updated_at: number
}

function rowToConfig(row: ServiceRow): AgentServiceConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AgentServiceConfig['type'],
    apiKey: row.api_key,
    baseUrl: row.base_url || undefined,
    monthlyCap: row.monthly_cap,
    resetDay: row.reset_day || 1,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ─── CRUD ─────────────────────────────────

export function listAgentServices(): { ok: boolean; data?: AgentServiceConfig[]; error?: string } {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM agent_services ORDER BY name').all() as ServiceRow[]
    return { ok: true, data: rows.map(rowToConfig) }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export function createAgentService(input: Partial<AgentServiceConfig>): { ok: boolean; data?: AgentServiceConfig; error?: string } {
  if (!input.name?.trim()) return { ok: false, error: '이름은 필수입니다.' }
  if (!input.type) return { ok: false, error: '서비스 종류를 선택하세요.' }

  try {
    const db = getDatabase()
    const id = input.id || crypto.randomUUID()
    const now = Date.now()
    db.prepare(`
      INSERT INTO agent_services (id, name, type, api_key, base_url, monthly_cap, reset_day, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, input.name.trim(), input.type, input.apiKey || '', input.baseUrl || '', input.monthlyCap || 0, input.resetDay || 1, now, now)

    const row = db.prepare('SELECT * FROM agent_services WHERE id = ?').get(id) as ServiceRow
    return { ok: true, data: rowToConfig(row) }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export function updateAgentService(id: string, input: Partial<AgentServiceConfig>): { ok: boolean; data?: AgentServiceConfig; error?: string } {
  try {
    const db = getDatabase()
    const existing = db.prepare('SELECT * FROM agent_services WHERE id = ?').get(id) as ServiceRow | undefined
    if (!existing) return { ok: false, error: '서비스를 찾을 수 없습니다.' }

    const now = Date.now()
    db.prepare(`
      UPDATE agent_services SET name = ?, type = ?, api_key = ?, base_url = ?, monthly_cap = ?, reset_day = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name ?? existing.name,
      input.type ?? existing.type,
      input.apiKey ?? existing.api_key,
      input.baseUrl ?? existing.base_url,
      input.monthlyCap ?? existing.monthly_cap,
      input.resetDay ?? existing.reset_day,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
      now, id
    )

    const row = db.prepare('SELECT * FROM agent_services WHERE id = ?').get(id) as ServiceRow
    return { ok: true, data: rowToConfig(row) }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export function deleteAgentService(id: string): { ok: boolean; error?: string } {
  try {
    const db = getDatabase()
    db.prepare('DELETE FROM agent_services WHERE id = ?').run(id)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

// ─── Fetch all usage ──────────────────────

export async function fetchAllUsage(): Promise<{ ok: boolean; data?: AgentUsageSnapshot[]; error?: string }> {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM agent_services WHERE enabled = 1 ORDER BY name').all() as ServiceRow[]
    const configs = rows.map(rowToConfig)

    const snapshots = await Promise.all(configs.map(config => fetchUsage(config)))

    // Persist snapshots
    const now = Date.now()
    for (const snap of snapshots) {
      db.prepare(`
        INSERT OR REPLACE INTO agent_usage_cache (service_id, used, limit_amount, remaining, percent, reset_at, currency, status, error, daily, weekly, monthly, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(snap.serviceId, snap.used, snap.limit, snap.remaining, snap.percent, snap.resetAt, snap.currency, snap.status, snap.error || '', snap.daily || 0, snap.weekly || 0, snap.monthly || 0, now)
    }

    return { ok: true, data: snapshots }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

// ─── Get cached snapshots ─────────────────

export function getCachedUsage(): { ok: boolean; data?: AgentUsageSnapshot[]; error?: string } {
  try {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT c.*, s.name as service_name, s.type as service_type
      FROM agent_usage_cache c
      JOIN agent_services s ON s.id = c.service_id
      ORDER BY s.name
    `).all() as any[]

    const snapshots: AgentUsageSnapshot[] = rows.map(r => ({
      serviceId: r.service_id,
      serviceName: r.service_name,
      type: r.service_type,
      used: r.used,
      limit: r.limit_amount,
      remaining: r.remaining,
      percent: r.percent,
      resetAt: r.reset_at,
      currency: r.currency,
      status: r.status,
      error: r.error || undefined,
      fetchedAt: r.fetched_at,
      daily: r.daily,
      weekly: r.weekly,
      monthly: r.monthly,
    }))

    return { ok: true, data: snapshots }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

// ─── Pet State ────────────────────────────

export function computePetState(snapshots: AgentUsageSnapshot[]): AgentPetState {
  if (snapshots.length === 0) {
    return { mood: 'happy', speed: 1, message: '등록된 서비스가 없어요!' }
  }

  const maxPercent = Math.max(...snapshots.map(s => s.percent))
  const hasError = snapshots.some(s => s.status === 'error')

  if (maxPercent >= 100) {
    return { mood: 'collapsed', speed: 0, message: '한도 초과! 리셋까지 좀 쉬게 해줘...' }
  }
  if (maxPercent >= 90) {
    return { mood: 'panicking', speed: 3, message: '⚠️ 거의 다 썼어! 리셋까지 얼마 안 남았어!' }
  }
  if (maxPercent >= 70) {
    return { mood: 'sweating', speed: 2, message: '💦 좀 빡빡해... 속도 올릴게!' }
  }
  if (maxPercent >= 40) {
    return { mood: 'running', speed: 1.5, message: '🚴 달리는 중! 순조로워~' }
  }
  if (hasError) {
    return { mood: 'happy', speed: 1, message: '🔧 일부 서비스 연결 확인 필요' }
  }
  return { mood: 'celebrating', speed: 0.8, message: '🎉 여유로워! 오늘도 굿!' }
}

// ─── File counters ────────────────────────

export function countLocalFiles(): { skillCount: number; mdCount: number } {
  const fs = require('fs')
  const path = require('path')

  const scanPaths = [
    path.join(require('os').homedir(), 'AppData', 'Local', 'hermes', 'skills'),
    path.join('E:', 'Hermes', 'memory'),
  ]

  let skillCount = 0
  let mdCount = 0

  for (const scanPath of scanPaths) {
    try {
      if (!fs.existsSync(scanPath)) continue
      const entries = fs.readdirSync(scanPath, { recursive: true, withFileTypes: false }) as string[]
      for (const entry of entries) {
        if (entry.endsWith('.md')) mdCount++
        if (entry.endsWith('SKILL.md')) skillCount++
      }
    } catch { /* skip inaccessible */ }
  }

  return { skillCount, mdCount }
}
