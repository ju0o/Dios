import { welcomeCopy, type StartLook } from '../../core/start/welcome'

interface WelcomeViewProps {
  look: StartLook
  onOpenLibrary: () => void
  onDismiss: () => void
}

/**
 * Shown once, the first time DIOS opens on a computer that is not the Founder's.
 * The Founder's computer keeps 지금 할 일 as the first screen.
 */
export function WelcomeView({ look, onOpenLibrary, onDismiss }: WelcomeViewProps) {
  const copy = welcomeCopy(look)
  return (
    <section className="welcome-panel" aria-label="이 컴퓨터에서 찾은 것">
      <p className="skill-quiet">처음 여는 화면</p>
      <h1>{copy.headline}</h1>
      <p className="welcome-next">{copy.next}</p>
      <div className="skill-toolbar">
        <button type="button" className="skill-action is-primary" onClick={onOpenLibrary}>스킬 라이브러리 보기</button>
        <button type="button" className="skill-action" onClick={onDismiss}>알겠어요</button>
      </div>
    </section>
  )
}
