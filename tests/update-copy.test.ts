import { describe, expect, it } from 'vitest'
import { explainUpdateError, initialUpdateState, updateCopy } from '../src/core/update/update-copy'

describe('update button copy', () => {
  it('hides itself when unpacked and offers a check when installed', () => {
    expect(updateCopy(initialUpdateState('0.2.0', false)).label).toBe('')
    const idle = updateCopy(initialUpdateState('0.2.0', true))
    expect(idle.label).toBe('업데이트 확인')
    expect(idle.actionable).toBe(true)
  })

  it('names the version at each step and only enables the button when a press does something', () => {
    const base = initialUpdateState('0.2.0', true)
    expect(updateCopy({ ...base, phase: 'checking' })).toMatchObject({ actionable: false })
    expect(updateCopy({ ...base, phase: 'none' }).label).toBe('지금이 최신이에요 (0.2.0)')
    expect(updateCopy({ ...base, phase: 'available', next: '0.3.0' })).toMatchObject({ label: '새 버전 0.3.0이 있어요 · 받기', tone: 'watch', actionable: true })
    expect(updateCopy({ ...base, phase: 'downloading', percent: 42.4 })).toMatchObject({ label: '받는 중 42%', actionable: false })
    expect(updateCopy({ ...base, phase: 'ready', next: '0.3.0' }).label).toContain('지금 다시 시작')
    expect(updateCopy({ ...base, phase: 'error' }).label).toContain('다시 시도')
  })

  it('explains failures in plain words', () => {
    expect(explainUpdateError('net::ERR_INTERNET_DISCONNECTED')).toContain('인터넷')
    expect(explainUpdateError('Cannot find latest.yml in the latest release artifacts')).toContain('아직 새 설치 파일이 없어요')
    expect(explainUpdateError('sha512 checksum mismatch')).toContain('손상')
    expect(explainUpdateError('something odd')).toContain('다시 눌러')
  })
})
