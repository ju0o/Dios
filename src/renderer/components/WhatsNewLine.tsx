import { useEffect, useState } from 'react'
import { isFreshUpdate, whatsNewCopy, type WhatsNew } from '../../core/update/whats-new'

const SEEN_KEY = 'dios.version.seen'

function readSeen(): string {
  try {
    return window.localStorage.getItem(SEEN_KEY) || ''
  } catch {
    return ''
  }
}

function writeSeen(version: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, version)
  } catch {
    // Without storage the line shows again next time, which is harmless.
  }
}

/**
 * One line at the top after an update: which version this is and what changed.
 * Shown once per version. The very first install only remembers the version.
 */
export function WhatsNewLine() {
  const [news, setNews] = useState<WhatsNew | null>(null)

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { whatsNew?: () => Promise<WhatsNew> } }).electronAPI
    if (!api?.whatsNew) return
    let cancel = false
    api.whatsNew().then((current) => {
      if (cancel || !current?.version) return
      const seen = readSeen()
      if (isFreshUpdate(seen, current.version)) setNews(current)
      else if (!seen) writeSeen(current.version)
    }).catch(() => {})
    return () => { cancel = true }
  }, [])

  if (!news) return null
  const copy = whatsNewCopy(news)

  function close() {
    if (news) writeSeen(news.version)
    setNews(null)
  }

  return (
    <div className="whats-new" role="status">
      <div className="whats-new-body">
        <p>{copy.headline}</p>
        {copy.more.length > 0 && (
          <details className="whats-new-more">
            <summary>더 바뀐 것 {copy.more.length}개</summary>
            <ul>{copy.more.map((line) => <li key={line}>{line}</li>)}</ul>
          </details>
        )}
      </div>
      <button type="button" className="skill-action" onClick={close}>알겠어요</button>
    </div>
  )
}
