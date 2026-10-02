import type { RepoLeftover, TidyReport } from '../../core/tidy/types'

export type { HeadlessProcess, HeavyFolder, RepoLeftover, ScheduledJob, TidyReport } from '../../core/tidy/types'

export interface TidyOutcome {
  ok: boolean
  message: string
}

/** 정리 calls exposed by the Electron preload. */
export interface TidyApi {
  /** The last report, or a fresh look when `refresh` is true. */
  tidyReport: (refresh?: boolean) => Promise<TidyReport>
  tidyOpen: (target: string) => Promise<TidyOutcome>
  tidyStop: (pid: number) => Promise<TidyOutcome>
  tidyTrash: (target: string) => Promise<TidyOutcome>
  tidyPruneWorktrees: (repo: string) => Promise<TidyOutcome & { repo?: RepoLeftover }>
  /** Reused from API 키 관리: pick more project folders to look through. */
  apiKeysAddScanRoot?: () => Promise<{ ok: boolean; message: string }>
}

/** The preload API, or null when the page is opened outside the desktop app. */
export function tidyApi(): TidyApi | null {
  const api = (window as unknown as { electronAPI?: Partial<TidyApi> }).electronAPI
  return api?.tidyReport && api.tidyOpen ? (api as TidyApi) : null
}
