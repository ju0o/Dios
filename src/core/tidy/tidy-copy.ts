import { repoHasUnsaved } from './git-leftovers'
import { bytesText, heavyTotal } from './space-hogs'
import type { TidyReport } from './types'

/** First line of the 정리 screen: what needs eyes today, in one sentence. */
export function tidyHeadline(report: TidyReport): string {
  const repos = report.repos.filter(repoHasUnsaved).length
  const running = report.processes.length
  const jobs = report.jobs.filter((job) => job.enabled).length
  const space = heavyTotal(report.heavy)
  const parts: string[] = []
  if (repos > 0) parts.push(`저장 안 한 수정이 있는 프로젝트 ${repos}곳`)
  if (running > 0) parts.push(`창 없이 켜져 있는 프로그램 ${running}개`)
  if (jobs > 0) parts.push(`혼자 도는 예약 작업 ${jobs}개`)
  if (space >= 100 * 1048576) parts.push(`비울 수 있는 자리 ${bytesText(space)}`)
  if (!parts.length) return report.scannedAt ? '지금은 정리할 게 없어요. 깨끗해요.' : '아직 살펴보지 않았어요.'
  return `${parts.join(', ')}예요.`
}

/** Section headers with counts, so each card says how much is inside before it is opened. */
export function sectionTitle(kind: 'repos' | 'jobs' | 'processes' | 'heavy', count: number): string {
  switch (kind) {
    case 'repos': return count ? `저장 안 한 수정 · 프로젝트 ${count}곳` : '저장 안 한 수정'
    case 'processes': return count ? `창 없이 켜져 있는 프로그램 ${count}개` : '창 없이 켜져 있는 프로그램'
    case 'jobs': return count ? `혼자 도는 예약 작업 ${count}개` : '혼자 도는 예약 작업'
    case 'heavy': return count ? `자리만 차지하는 폴더 ${count}곳` : '자리만 차지하는 폴더'
  }
}

/** What an empty section says, so a blank card is still an answer. */
export function emptyLine(kind: 'repos' | 'jobs' | 'processes' | 'heavy', rootsCount: number): string {
  switch (kind) {
    case 'repos': return rootsCount ? '훑은 폴더 안의 프로젝트는 전부 저장돼 있어요.' : 'API 키 관리에서 프로젝트 폴더를 골라 두면 여기서도 같이 살펴봐요.'
    case 'processes': return '창 없이 돌아가는 개발 서버가 없어요.'
    case 'jobs': return '혼자 도는 예약 작업이 없어요.'
    case 'heavy': return '20MB가 넘는 꾸러미·결과물 폴더가 없어요.'
  }
}
