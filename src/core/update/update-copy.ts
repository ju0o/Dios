/** Where the in-app update stands. `dev` means an unpacked build that cannot update itself. */
export type UpdatePhase = 'dev' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** Version running now, like 0.2.0. */
  current: string
  /** Version on GitHub when one is newer, else ''. */
  next: string
  /** 0..100 while downloading. */
  percent: number
  /** Developer detail for 원문 보기. Empty when nothing went wrong. */
  detail: string
}

export interface UpdateCopy {
  /** The button label, in Korean. */
  label: string
  /** True when pressing the button does something now. */
  actionable: boolean
  /** amber when there is something new, teal when up to date, '' otherwise. */
  tone: 'ok' | 'watch' | ''
}

export function initialUpdateState(current: string, packaged: boolean): UpdateState {
  return { phase: packaged ? 'idle' : 'dev', current, next: '', percent: 0, detail: '' }
}

/** One label per phase. The Founder sees only this line and, if needed, a folded detail. */
export function updateCopy(state: UpdateState): UpdateCopy {
  switch (state.phase) {
    case 'dev': return { label: '', actionable: false, tone: '' }
    case 'idle': return { label: '업데이트 확인', actionable: true, tone: '' }
    case 'checking': return { label: '새 버전이 있는지 보는 중…', actionable: false, tone: '' }
    case 'none': return { label: `지금이 최신이에요 (${state.current})`, actionable: true, tone: 'ok' }
    case 'available': return { label: `새 버전 ${state.next}이 있어요 · 받기`, actionable: true, tone: 'watch' }
    case 'downloading': return { label: `받는 중 ${Math.max(0, Math.min(100, Math.round(state.percent)))}%`, actionable: false, tone: 'watch' }
    case 'ready': return { label: `${state.next} 준비됐어요 · 지금 다시 시작`, actionable: true, tone: 'watch' }
    case 'error': return { label: '확인하지 못했어요 · 다시 시도', actionable: true, tone: '' }
    default: return { label: '업데이트 확인', actionable: true, tone: '' }
  }
}

/** Plain-Korean reason for a failed check, from the updater's English error. */
export function explainUpdateError(message: string): string {
  const text = message || ''
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR|network|fetch failed/i.test(text)) return '인터넷에 닿지 못했어요. 연결을 확인하고 다시 눌러 주세요.'
  if (/404|Cannot find|latest\.yml|No published versions/i.test(text)) return 'GitHub에 아직 새 설치 파일이 없어요. 지금 버전을 그대로 쓰면 돼요.'
  if (/sha512|checksum|signature/i.test(text)) return '받은 파일이 손상돼서 설치하지 않았어요. 다시 받아 주세요.'
  if (/EPERM|EACCES|EBUSY/i.test(text)) return '설치 파일을 쓸 수 없어요. DIOS를 껐다가 다시 켜고 시도해 주세요.'
  return '업데이트를 확인하지 못했어요. 잠시 뒤에 다시 눌러 주세요.'
}
