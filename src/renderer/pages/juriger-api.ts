import type { BridgeRead, CommandWrite, JurigerAction } from '../../core/juriger/read-bridge'

export type { BridgeRead, CommandWrite, JurigerAction }

/** JuRiger calls exposed by the Electron preload. */
export interface JurigerApi {
  jurigerState: () => Promise<BridgeRead>
  jurigerCommand: (action: JurigerAction, targetId: string) => Promise<CommandWrite>
  onJuriger?: (callback: (view: BridgeRead) => void) => () => void
}

/** The preload API, or null when the page is opened outside the desktop app. */
export function jurigerApi(): JurigerApi | null {
  const api = (window as unknown as { electronAPI?: Partial<JurigerApi> }).electronAPI
  return api?.jurigerState && api.jurigerCommand ? (api as JurigerApi) : null
}
