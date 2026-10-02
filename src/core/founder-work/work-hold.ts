/**
 * 지금 할 일 is parked for now (Founder, 2026-10-02): the list did not tidy itself
 * reliably, so it leaves the first screen and the main menu until it is reworked.
 * The screen stays reachable under 더 보기 and can be put back from 설정.
 *
 * 기능을 지우지 않고 "보류"만 합니다. 설정에서 다시 켤 수 있습니다.
 */

export const WORK_HOLD_KEY = 'dios.work.enabled'

/** Minimal storage shape so this works with localStorage and in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** True when the Founder has switched the screen back on. Default is off (held). */
export function isWorkListOn(store: KeyValueStore | null | undefined): boolean {
  try {
    return store?.getItem(WORK_HOLD_KEY) === '1'
  } catch {
    return false
  }
}

/** Remember the Founder's choice. Silently does nothing when storage is unavailable. */
export function setWorkListOn(store: KeyValueStore | null | undefined, on: boolean): void {
  try {
    if (on) store?.setItem(WORK_HOLD_KEY, '1')
    else store?.removeItem(WORK_HOLD_KEY)
  } catch {
    // Without storage the choice just does not persist.
  }
}

/** The screen the app opens on, given whether 지금 할 일 is on. */
export function firstView(workOn: boolean): 'now' | 'skillBoard' {
  return workOn ? 'now' : 'skillBoard'
}

/** One line shown at the top of 지금 할 일 while the feature is parked. */
export const WORK_HOLD_LINE = '이 화면은 잠시 쉬고 있어요. 목록이 스스로 정리되지 않아 다듬는 중이에요. 설정에서 다시 켤 수 있어요.'
