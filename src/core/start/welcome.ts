/** What DIOS found on this computer the first time someone else opens it. */
export interface StartLook {
  /** True on the Founder's computer, which already has the to-do folders. */
  founder: boolean
  /** Ready agents, in Korean: Claude, Codex, Cursor. */
  agents: string[]
  skillCount: number
  /** Skills that live in only one folder and can move into the shared folder. */
  looseCount: number
  newCount: number
}

export interface WelcomeCopy {
  headline: string
  next: string
}

/** The two lines on the first-open screen. The Founder's computer never shows this. */
export function welcomeCopy(look: Pick<StartLook, 'agents' | 'skillCount' | 'looseCount' | 'newCount'>): WelcomeCopy {
  const foundAgents = look.agents.length ? `${look.agents.join(', ')}를 찾았어요.` : ''
  const foundSkills = look.skillCount ? `스킬 ${look.skillCount}개가 있어요.` : ''
  if (!foundAgents && !foundSkills) {
    return {
      headline: '이 컴퓨터에서 아직 에이전트나 스킬을 못 찾았어요.',
      next: 'Claude, Codex, Cursor를 쓰면 스킬이 여기에 모여요. 주소가 있으면 라이브러리에서 받을 수 있어요.',
    }
  }
  const loose = look.looseCount
    ? `한 폴더에만 있는 스킬이 ${look.looseCount}개예요. 라이브러리에서 한 번에 모을 수 있어요.`
    : '스킬 라이브러리에서 주소로 더 받을 수 있어요.'
  const fresh = look.newCount ? ` 이번 주에 ${look.newCount}개가 새로 생겼어요.` : ''
  return {
    headline: ['이 컴퓨터에서', foundAgents, foundSkills].filter(Boolean).join(' '),
    next: `${loose}${fresh}`,
  }
}
