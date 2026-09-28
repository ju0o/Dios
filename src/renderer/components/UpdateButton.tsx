import { useEffect, useState } from 'react'
import { updateCopy, type UpdateState } from '../../core/update/update-copy'

interface UpdateApi {
  updateState: () => Promise<UpdateState>
  updateCheck: () => Promise<UpdateState>
  updateDownload: () => Promise<UpdateState>
  updateInstall: () => Promise<UpdateState>
  onUpdateState: (callback: (state: UpdateState) => void) => () => void
}

function updateApi(): UpdateApi | null {
  const api = (window as unknown as { electronAPI?: Partial<UpdateApi> }).electronAPI
  return api?.updateState ? (api as UpdateApi) : null
}

/**
 * One button in the sidebar: check, get, and restart. Nothing downloads without a press.
 * Hidden while running unpacked, since only the installed app can update itself.
 */
export function UpdateButton() {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    const api = updateApi()
    if (!api) return
    let cancel = false
    api.updateState().then((current) => { if (!cancel) setState(current) }).catch(() => {})
    const off = api.onUpdateState((next) => setState(next))
    return () => {
      cancel = true
      off()
    }
  }, [])

  if (!state || state.phase === 'dev') return null
  const copy = updateCopy(state)

  async function press() {
    const api = updateApi()
    if (!api || !state) return
    try {
      if (state.phase === 'available') setState(await api.updateDownload())
      else if (state.phase === 'ready') await api.updateInstall()
      else setState(await api.updateCheck())
    } catch {
      setState({ ...state, phase: 'error', detail: '업데이트를 확인하지 못했어요. 잠시 뒤에 다시 눌러 주세요.' })
    }
  }

  const reason = state.phase === 'error' ? state.detail.split('\n')[0] : ''
  const raw = state.phase === 'error' ? state.detail.split('\n').slice(1).join('\n') : ''

  return (
    <div className="update-slot">
      <button
        type="button"
        className={`sidebar-link update-button ${copy.tone === 'watch' ? 'is-watch' : ''} ${copy.tone === 'ok' ? 'is-ok' : ''}`}
        onClick={() => void press()}
        disabled={!copy.actionable}
        aria-busy={state.phase === 'checking' || state.phase === 'downloading'}
        aria-live="polite"
      >
        <span>{copy.tone === 'watch' ? '●' : '↻'}</span>{copy.label}
      </button>
      {state.phase === 'downloading' && <progress className="update-progress" max={100} value={Math.round(state.percent)} aria-label="받는 중" />}
      {reason && (
        <details className="update-reason">
          <summary>{reason}</summary>
          {raw && <pre>{raw}</pre>}
        </details>
      )}
    </div>
  )
}
