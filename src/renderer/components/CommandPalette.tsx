import { useEffect, useMemo, useState } from 'react'

type CommandPaletteProps = { onNavigate: (view: string) => void }

const commands = [
  ['skillBoard', '스킬 보드', '에이전트에 스킬 붙이고 빼기', '✧'],
  ['agentMonitor', '사용량', 'AI 사용량 보기', '◔'],
  ['home', '프로젝트 홈', '현재 Phase와 다음 행동 보기', '⌂'],
  ['project-data', '프로젝트 자료', '폴더·Skills·Memory 연결 관리', '⌗'],
  ['changes', '변경사항 확인', 'Git 변경 목록과 테스트 결과', '⌁'],
  ['maintenance', '유지보수 열기', '체크리스트·운영지침·타임라인', '◌'],
  ['backups', '백업·복구 열기', '백업 생성과 복구', '◒'],
  ['environment', '환경 상태 열기', '메모리·디스크·폴더 상태', '⌘'],
  ['requests', 'Agent 요청서 만들기', '안전한 작업 지시서 생성', '✦'],
  ['files', '자료 스캔 열기', '로컬 폴더 연결', '⌗'],
  ['skills', 'Skills 열기', 'Skill 읽기와 한글 번역', '✧'],
  ['memory', 'Memory 열기', '메모리 파일 탐색', '◫'],
  ['settings', '설정 열기', '스캔·백업 보관 정책', '⚙'],
] as const

export function CommandPalette({ onNavigate }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => commands.filter(([, label, description]) => `${label} ${description}`.toLowerCase().includes(query.toLowerCase())), [query])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(true); setQuery('') }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!open) return null
  return <div className="command-backdrop" onMouseDown={() => setOpen(false)}><div className="command-dialog glass-strong" onMouseDown={(event) => event.stopPropagation()}><div className="command-head"><span>빠른 명령</span><kbd>ESC</kbd></div><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="화면이나 작업을 검색하세요..." /><div className="command-list">{filtered.map(([id, label, description, icon]) => <button key={id} onClick={() => { onNavigate(id); setOpen(false) }}><span className="command-icon">{icon}</span><span><b>{label}</b><small>{description}</small></span><i>↵</i></button>)}{!filtered.length && <div className="empty-line">검색 결과가 없습니다.</div>}</div><div className="command-foot"><span><kbd>Ctrl</kbd> + <kbd>K</kbd> 다시 열기</span><span>페이지 이동은 데이터를 변경하지 않습니다.</span></div></div></div>
}
