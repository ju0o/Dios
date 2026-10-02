import type { BridgeRead, JurigerSkill, JurigerSuggestion } from './read-bridge'

/** The one status sentence. Stale and offline win over the status JuRiger last wrote. */
export function bridgeStatusLine(view: BridgeRead): string {
  if (view.kind === 'missing') return 'JuRiger가 이 컴퓨터에 아직 없어요.'
  if (view.kind === 'unreadable') return 'JuRiger 상태를 읽지 못했어요. 파일이 깨져 있을 수 있어요.'
  if (view.kind === 'unsupported') return '현재 DIOS가 지원하는 것보다 새로운 JuRiger 데이터 형식입니다.'
  if (view.freshness === 'offline') return 'JuRiger와 연결되지 않았어요.'
  if (view.freshness === 'stale') return 'JuRiger 상태를 다시 확인하는 중'
  if (view.state.status === 'paused') return '잠시 멈춤'
  if (view.state.status === 'error') return view.state.error || 'JuRiger에 문제가 있어요.'
  return '관찰 중'
}

/** First line of the screen: what to do now. */
export function jurigerHeadline(view: BridgeRead): string {
  if (view.kind !== 'ready' || view.freshness !== 'fresh') return bridgeStatusLine(view)
  const count = view.state.newSuggestionCount
  if (count > 0) return `새 제안 ${count}개가 있어요. 수락하거나 무시해 주세요.`
  if (view.state.status === 'paused') return 'JuRiger가 잠시 멈춰 있어요.'
  if (view.state.status === 'error') return bridgeStatusLine(view)
  return 'JuRiger가 이 컴퓨터를 살펴보고 있어요.'
}

export function savedMinutesLine(minutes: number): string {
  return `이번 주 예상 절약 ${minutes}분`
}

export function weekMinutesLine(minutes: number): string {
  return `주 ${minutes}분`
}

export function repeatsLine(count: number): string {
  return `${count}회 반복`
}

const SKILL_STATUS_LABEL: Record<JurigerSkill['status'], string> = {
  ready: '준비됨',
  active: '쓰는 중',
  paused: '잠시 멈춤',
  failed: '실패',
  '': '상태 모름',
}

export function skillStatusLine(status: JurigerSkill['status']): string {
  return SKILL_STATUS_LABEL[status]
}

export function runResultLine(result: 'ok' | 'failed' | ''): string {
  if (result === 'ok') return '성공'
  if (result === 'failed') return '실패'
  return '결과 없음'
}

const SEVERITY_LABEL: Record<JurigerSuggestion['severity'], string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  '': '',
}

export function severityLine(severity: JurigerSuggestion['severity']): string {
  return SEVERITY_LABEL[severity]
}
