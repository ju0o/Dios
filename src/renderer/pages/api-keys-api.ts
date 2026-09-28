import type { ApiKeyCard, ApiKeyInput } from '../../core/api-keys/api-key-text'
import type { KeyResult } from '../../core/api-keys/api-key-store'
import type { AgentUsageSnapshot } from '../../core/agent-monitor/types'

export type { ApiKeyCard, ApiKeyInput, KeyResult }

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
}

export interface ListingResult {
  ok: boolean
  message: string
  listing: KeyListing
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
  apiKeysScan: () => Promise<ListingResult & { added: number }>
  apiKeysAddScanRoot: () => Promise<ListingResult>
  apiKeysRemoveScanRoot: (root: string) => Promise<ListingResult>
  apiKeysRefreshUsage: () => Promise<ListingResult>
}

/** The preload API, or null when the page is opened outside the desktop app. */
export function apiKeysApi(): ApiKeysApi | null {
  const api = (window as unknown as { electronAPI?: Partial<ApiKeysApi> }).electronAPI
  return api?.apiKeysList && api.apiKeysAdd ? (api as ApiKeysApi) : null
}
