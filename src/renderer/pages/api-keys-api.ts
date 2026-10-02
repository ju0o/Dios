import type { ApiKeyCard, ApiKeyInput, PublicCandidate } from '../../core/api-keys/api-key-text'
import type { KeyResult } from '../../core/api-keys/api-key-store'
import type { RootReport } from '../../core/api-keys/env-scan'
import type { AgentUsageSnapshot } from '../../core/agent-monitor/types'

export type { ApiKeyCard, ApiKeyInput, KeyResult, RootReport, PublicCandidate }

/** Where a scan folder came from: the Founder picked it, it is a connected project, or it is a common home. */
export type ScanOrigin = 'picked' | 'project' | 'default'

export interface KeyListing {
  cards: ApiKeyCard[]
  /** Project names to suggest in the form. */
  projects: string[]
  /** True when this computer locks keys with its own key store. */
  locked: boolean
  /** Last usage numbers, matched to cards through serviceId. */
  usage: AgentUsageSnapshot[]
  /** Folders the scan looks through. */
  scanRoots: string[]
  /** Origin per folder in `scanRoots`. */
  scanRootOrigins: Record<string, ScanOrigin>
}

export interface ListingResult {
  ok: boolean
  message: string
  listing: KeyListing
}

/** One scan folder after a scan, with a plain Korean line for the row. */
export interface ScanRootResult extends RootReport {
  /** Keys from this folder that were new in the store. */
  added: number
  line: string
}

export interface ScanResult extends ListingResult {
  added: number
  roots: ScanRootResult[]
  /** Epoch ms; 0 when nothing was scanned (e.g. the folder dialog was closed). */
  scannedAt: number
  /** Keys waiting for a yes. Masked. Absent on older replies. */
  candidates?: PublicCandidate[]
  /** Remote computers that could not be reached. */
  notes?: string[]
  /** Short line for the candidate card. */
  lead?: string
}

/** API key calls exposed by the Electron preload. */
export interface ApiKeysApi {
  apiKeysList: () => Promise<KeyListing>
  apiKeysAdd: (input: ApiKeyInput) => Promise<KeyResult>
  apiKeysUpdate: (id: string, input: ApiKeyInput) => Promise<KeyResult & { undoEnv?: boolean }>
  apiKeysDelete: (id: string) => Promise<KeyResult & { undoId: string }>
  apiKeysUndoDelete: (id: string) => Promise<KeyResult>
  apiKeysUndoEnv: () => Promise<KeyResult>
  apiKeysCheck: () => Promise<ListingResult>
  apiKeysCopy: (id: string) => Promise<{ ok: boolean; message: string }>
  apiKeysPeek: (id: string) => Promise<{ ok: boolean; message: string; key: string }>
  apiKeysPeekAll: () => Promise<Record<string, string>>
  /** Scan every known folder, or only `onlyRoots`. */
  apiKeysScan: (onlyRoots?: string[]) => Promise<ScanResult>
  /** Look for new projects here and on the other computer. */
  apiKeysDiscover: () => Promise<ScanResult>
  /** Save the chosen candidate ids. The secret stays in the main process. */
  apiKeysSaveCandidates: (ids: string[]) => Promise<ScanResult>
  /** Forget the chosen candidates without saving. */
  apiKeysDismissCandidates: (ids: string[]) => Promise<ScanResult>
  /** Open the folder dialog, remember the picked folders, and scan just those. */
  apiKeysScanPick: () => Promise<ScanResult>
  apiKeysAddScanRoot: () => Promise<ListingResult>
  apiKeysRemoveScanRoot: (root: string) => Promise<ListingResult>
  apiKeysOpenScanRoot: (root: string) => Promise<{ ok: boolean; message: string }>
  apiKeysRefreshUsage: () => Promise<ListingResult>
}

/** The preload API, or null when the page is opened outside the desktop app. */
export function apiKeysApi(): ApiKeysApi | null {
  const api = (window as unknown as { electronAPI?: Partial<ApiKeysApi> }).electronAPI
  return api?.apiKeysList && api.apiKeysAdd ? (api as ApiKeysApi) : null
}
