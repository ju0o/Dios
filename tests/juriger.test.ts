import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { bridgeStatusLine, jurigerHeadline, repeatsLine, savedMinutesLine, skillStatusLine } from '../src/core/juriger/juriger-copy'
import {
  BRIDGE_SCHEMA,
  JURIGER_COMMAND_TTL_MS,
  JURIGER_OFFLINE_AFTER_MS,
  JURIGER_STALE_AFTER_MS,
  bridgeRoot,
  freshnessOf,
  readBridge,
  writeCommand,
  type BridgeRead,
} from '../src/core/juriger/read-bridge'

const temps: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-juriger-'))
  temps.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const NOW = Date.parse('2026-10-02T11:00:00+09:00')
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'juriger-state.json'), 'utf8')

function withUpdated(iso: string): string {
  const value = JSON.parse(FIXTURE) as { updated_at: string }
  value.updated_at = iso
  return JSON.stringify(value)
}

describe('bridge location', () => {
  it('uses the override, then LocalAppData on Windows, and nothing elsewhere', () => {
    expect(bridgeRoot('linux', { DIOS_JURIGER_BRIDGE: '/tmp/bridge' })).toBe('/tmp/bridge')
    expect(bridgeRoot('win32', { LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local' })).toBe(path.join('C:\\Users\\user\\AppData\\Local', 'JuRiger', 'bridge'))
    expect(bridgeRoot('linux', {})).toBe('')
    expect(bridgeRoot('win32', { DIOS_JURIGER_BRIDGE: 'D:\\custom', LOCALAPPDATA: 'C:\\x' })).toBe('D:\\custom')
  })
})

describe('state.json', () => {
  it('reads the fixture, including unknown fields, and ignores them', () => {
    const root = tempDir()
    fs.writeFileSync(path.join(root, 'state.json'), FIXTURE)
    const view = readBridge(root, NOW)
    expect(view.kind).toBe('ready')
    if (view.kind !== 'ready') return
    expect(view.freshness).toBe('fresh')
    expect(view.state.schema).toBe(BRIDGE_SCHEMA)
    expect(view.state.status).toBe('observing')
    expect(view.state.error).toBeNull()
    expect(view.state.ai).toEqual({ mode: 'ollama', model: 'qwen2.5:7b' })
    expect(view.state.newSuggestionCount).toBe(2)
    expect(view.state.savedMinutesThisWeek).toBe(34)
    expect(view.state.suggestions[0]).toMatchObject({
      id: 's-001',
      title: 'Agent 결과 전달 반복',
      plainSummary: '같은 결과를 에이전트 창에 여러 번 붙여 넣고 있어요.',
      suggestedSkillName: 'Agent 결과 전달',
      occurrenceCount: 22,
      severity: 'medium',
      estimatedSavedMinutesPerWeek: 34,
    })
    expect(view.state.suggestions[0]).not.toHaveProperty('extra')
    expect(view.state.skills.map((skill) => skill.name)).toEqual(['Agent 결과 전달', '작업 완료 알림', '주간 정리'])
    expect(view.state.skills[0].lastRun).toMatchObject({ result: 'ok', note: '전달 완료' })
    expect(view.state.skills[1].lastRun).toBeNull()
    expect(view.state.recentRuns[0]).toMatchObject({ title: 'Agent 결과 전달', result: 'ok' })
    expect(jurigerHeadline(view)).toBe('새 제안 2개가 있어요. 수락하거나 무시해 주세요.')
    expect(bridgeStatusLine(view)).toBe('관찰 중')
    expect(savedMinutesLine(34)).toBe('이번 주 예상 절약 34분')
    expect(repeatsLine(22)).toBe('22회 반복')
    expect(skillStatusLine('ready')).toBe('준비됨')
  })

  it('reports a missing bridge without throwing', () => {
    expect(readBridge('')).toEqual({ kind: 'missing' })
    expect(readBridge(tempDir())).toEqual({ kind: 'missing' })
    expect(bridgeStatusLine({ kind: 'missing' })).toBe('JuRiger가 이 컴퓨터에 아직 없어요.')
  })

  it('reports broken JSON without throwing', () => {
    const root = tempDir()
    fs.writeFileSync(path.join(root, 'state.json'), '{ "schema": 1,')
    expect(readBridge(root).kind).toBe('unreadable')
    expect(readBridge(root, NOW, () => 'not json').kind).toBe('unreadable')
    fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ status: 'observing' }))
    expect(readBridge(root).kind).toBe('unreadable')
  })

  it('shows a newer schema instead of crashing', () => {
    const root = tempDir()
    const newer = JSON.parse(FIXTURE) as { schema: number }
    newer.schema = 2
    fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(newer))
    const view = readBridge(root, NOW)
    expect(view).toEqual({ kind: 'unsupported', schema: 2 })
    expect(bridgeStatusLine(view)).toBe('현재 DIOS가 지원하는 것보다 새로운 JuRiger 데이터 형식입니다.')
  })

  it('drops suggestion and skill rows that have no id', () => {
    const root = tempDir()
    const value = JSON.parse(FIXTURE) as { suggestions: unknown[]; skills: unknown[]; updated_at: string }
    value.updated_at = new Date(NOW).toISOString()
    value.suggestions.push({ title: 'no id' })
    value.skills.push('nope')
    fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(value))
    const view = readBridge(root, NOW)
    expect(view.kind).toBe('ready')
    if (view.kind !== 'ready') return
    expect(view.state.suggestions).toHaveLength(2)
    expect(view.state.skills).toHaveLength(3)
  })
})

describe('freshness', () => {
  it('stays fresh, then stale, then offline on the two thresholds', () => {
    expect(freshnessOf(NOW, NOW)).toBe('fresh')
    expect(freshnessOf(NOW - JURIGER_STALE_AFTER_MS + 1, NOW)).toBe('fresh')
    expect(freshnessOf(NOW - JURIGER_STALE_AFTER_MS, NOW)).toBe('stale')
    expect(freshnessOf(NOW - JURIGER_OFFLINE_AFTER_MS + 1, NOW)).toBe('stale')
    expect(freshnessOf(NOW - JURIGER_OFFLINE_AFTER_MS, NOW)).toBe('offline')
    expect(freshnessOf(0, NOW)).toBe('offline')
    expect(freshnessOf(NOW + 60_000, NOW)).toBe('fresh')
  })

  it('does not call an old observing file "관찰 중"', () => {
    const root = tempDir()
    const write = (age: number) => {
      fs.writeFileSync(path.join(root, 'state.json'), withUpdated(new Date(NOW - age).toISOString()))
      return readBridge(root, NOW)
    }
    const fresh = write(30_000)
    const stale = write(JURIGER_STALE_AFTER_MS + 1000)
    const offline = write(JURIGER_OFFLINE_AFTER_MS + 1000)
    expect(bridgeStatusLine(fresh)).toBe('관찰 중')
    expect(bridgeStatusLine(stale)).toBe('JuRiger 상태를 다시 확인하는 중')
    expect(bridgeStatusLine(offline)).toBe('JuRiger와 연결되지 않았어요.')
    expect(jurigerHeadline(stale)).toBe('JuRiger 상태를 다시 확인하는 중')
  })
})

describe('commands', () => {
  function bridge(): string {
    const root = tempDir()
    fs.writeFileSync(path.join(root, 'state.json'), FIXTURE)
    return root
  }

  it('writes one allowed command atomically and refuses a second file with the same id', () => {
    const root = bridge()
    const first = writeCommand(root, { id: 'cmd-001', action: 'accept_suggestion', targetId: 's-001', now: NOW, confirmedByUser: true })
    expect(first.ok).toBe(true)
    const saved = JSON.parse(fs.readFileSync(first.file, 'utf8')) as Record<string, unknown>
    expect(saved).toEqual({
      id: 'cmd-001',
      action: 'accept_suggestion',
      target_id: 's-001',
      created_at: new Date(NOW).toISOString(),
      expires_at: new Date(NOW + JURIGER_COMMAND_TTL_MS).toISOString(),
      confirmed_by_user: true,
    })
    expect(Date.parse(String(saved.expires_at)) - Date.parse(String(saved.created_at))).toBe(JURIGER_COMMAND_TTL_MS)
    expect(fs.readdirSync(path.join(root, 'commands')).filter((name) => name.endsWith('.tmp'))).toEqual([])
    const again = writeCommand(root, { id: 'cmd-001', action: 'dismiss_suggestion', targetId: 's-001', now: NOW, confirmedByUser: true })
    expect(again.ok).toBe(false)
    expect(JSON.parse(fs.readFileSync(first.file, 'utf8')).action).toBe('accept_suggestion')
  })

  it('refuses an action outside the four, an unconfirmed press, and an already expired command', () => {
    const root = bridge()
    const denied = ['delete_skill', 'enable_auto_run', 'external_send', 'environment_change', 'watch', '']
    for (const action of denied) {
      const result = writeCommand(root, { id: 'cmd-no', action, targetId: 's-001', now: NOW, confirmedByUser: true })
      expect(result.ok).toBe(false)
    }
    expect(writeCommand(root, { id: 'cmd-quiet', action: 'run_skill', targetId: 'k-001', now: NOW, confirmedByUser: false }).ok).toBe(false)
    expect(writeCommand(root, { id: 'cmd-old', action: 'open_juriger', targetId: '', now: NOW, ttlMs: 0, confirmedByUser: true }).ok).toBe(false)
    expect(writeCommand(root, { id: 'cmd-past', action: 'open_juriger', targetId: '', now: NOW, ttlMs: -1, confirmedByUser: true }).ok).toBe(false)
    expect(fs.existsSync(path.join(root, 'commands'))).toBe(false)
  })

  it('does not create a bridge folder that JuRiger has not made', () => {
    const missing = path.join(tempDir(), 'nope')
    const result = writeCommand(missing, { id: 'cmd-1', action: 'open_juriger', targetId: '', confirmedByUser: true })
    expect(result.ok).toBe(false)
    expect(fs.existsSync(missing)).toBe(false)
  })

  it('accepts every allowed action exactly once per id', () => {
    const root = bridge()
    const actions = ['open_juriger', 'run_skill', 'accept_suggestion', 'dismiss_suggestion'] as const
    actions.forEach((action, index) => {
      const result = writeCommand(root, { id: `cmd-${index}`, action, targetId: 'k-001', now: NOW, confirmedByUser: true })
      expect(result.ok).toBe(true)
      expect(JSON.parse(fs.readFileSync(result.file, 'utf8')).action).toBe(action)
    })
    expect(fs.readdirSync(path.join(root, 'commands')).filter((name) => name.endsWith('.json'))).toHaveLength(4)
  })
})

describe('copy for the other statuses', () => {
  it('says paused and error only while the file is fresh', () => {
    const paused: BridgeRead = {
      kind: 'ready',
      freshness: 'fresh',
      state: {
        schema: 1, updatedAt: '', updatedAtMs: NOW, status: 'paused', error: null, ai: { mode: '', model: '' },
        newSuggestionCount: 0, suggestions: [], skills: [], recentRuns: [], savedMinutesThisWeek: 0,
      },
    }
    expect(bridgeStatusLine(paused)).toBe('잠시 멈춤')
    expect(jurigerHeadline({ ...paused, state: { ...paused.state, status: 'observing' } })).toBe('JuRiger가 이 컴퓨터를 살펴보고 있어요.')
    expect(bridgeStatusLine({ ...paused, state: { ...paused.state, status: 'error', error: '모델을 못 찾았어요.' } })).toBe('모델을 못 찾았어요.')
  })
})
