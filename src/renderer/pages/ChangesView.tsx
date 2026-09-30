import { useEffect, useState } from 'react'
import {
  changesHeadline,
  fileChangesHeadline,
  parseGitStatus,
  skillChanges,
  testHeadline,
  type ActivityRow,
  type FileChanges,
  type SkillChange,
} from '../../core/changes/changes-copy'
import { useScan } from '../stores/scanStore'
import { whenText } from './skill-board-api'

interface WorkspaceReport {
  success: boolean
  error?: string
  status?: string
  diff?: string
  checkedAt?: number
}

interface TestRun {
  success: boolean
  error?: string
  output?: string
  checkedAt?: number
}

interface ChangesViewProps {
  onNavigate?: (view: string) => void
}

/** Folder name only; the full path stays under 원문 보기. */
function baseName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() || root
}

/**
 * What changed: skills turned on or off inside DIOS, and files in the connected work folder.
 * Git output and paths are folded away; the Founder reads sentences.
 */
export function ChangesView({ onNavigate }: ChangesViewProps) {
  const { roots } = useScan()
  const api = (window as any).electronAPI || {}
  const root = roots[0] || ''
  const [skills, setSkills] = useState<SkillChange[] | null>(null)
  const [report, setReport] = useState<WorkspaceReport | null>(null)
  const [files, setFiles] = useState<FileChanges | null>(null)
  const [tests, setTests] = useState<TestRun | null>(null)
  const [busy, setBusy] = useState<'' | 'files' | 'tests'>('')
  const [problem, setProblem] = useState('')

  async function loadSkills() {
    if (typeof api.listActivity !== 'function') {
      setSkills([])
      return
    }
    try {
      const rows = (await api.listActivity()) as ActivityRow[]
      setSkills(skillChanges(rows || []))
    } catch {
      setSkills([])
    }
  }

  useEffect(() => {
    void loadSkills()
  }, [])

  async function inspect() {
    if (!root) {
      setProblem('아직 작업 폴더가 없어요. 자료 스캔에서 폴더를 먼저 연결해 주세요.')
      return
    }
    if (typeof api.getWorkspaceReport !== 'function') {
      setProblem('이 화면은 DIOS 앱 안에서만 파일 변화를 읽을 수 있어요.')
      return
    }
    setBusy('files')
    setProblem('')
    try {
      const result = (await api.getWorkspaceReport(root)) as WorkspaceReport
      setReport(result)
      setFiles(result.success ? parseGitStatus(result.status || '') : null)
      if (!result.success) setProblem(`파일 변화를 읽지 못했어요. 이 폴더는 Git으로 관리하지 않는 것 같아요. ${result.error || ''}`.trim())
    } catch {
      setProblem('파일 변화를 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.')
    } finally {
      setBusy('')
    }
  }

  async function runTests() {
    if (!root) {
      setProblem('아직 작업 폴더가 없어요. 자료 스캔에서 폴더를 먼저 연결해 주세요.')
      return
    }
    if (typeof api.runWorkspaceTests !== 'function') {
      setProblem('이 화면은 DIOS 앱 안에서만 시험을 돌릴 수 있어요.')
      return
    }
    setBusy('tests')
    setProblem('')
    try {
      const result = (await api.runWorkspaceTests(root)) as TestRun
      setTests(result)
      if (!result.success && result.error) setProblem(`시험을 돌리지 못했어요. ${result.error}`)
    } catch {
      setProblem('시험을 돌리지 못했어요. 잠시 뒤 다시 눌러 주세요.')
    } finally {
      setBusy('')
    }
  }

  const skillCount = skills?.length ?? 0
  const fileGroups: Array<[string, string[]]> = files
    ? [['새 파일', files.added], ['고친 파일', files.changed], ['지운 파일', files.removed], ['이름 바꾼 파일', files.renamed]]
    : []

  return (
    <section className="skill-board" aria-label="변경사항">
      <header className="skill-top">
        <div>
          <p className="skill-lead">{changesHeadline(baseName(root), skillCount)}</p>
          <p className="skill-quiet">스킬을 켜고 끈 기록은 바로 남고, 파일 변화와 시험은 단추를 눌렀을 때만 읽어요. 뒤에서 도는 것은 없어요.</p>
        </div>
        <div className="skill-toolbar">
          {root ? (
            <>
              <button type="button" className="skill-action primary" disabled={Boolean(busy)} onClick={() => void inspect()}>{busy === 'files' ? '읽는 중…' : '바뀐 파일 보기'}</button>
              <button type="button" className="skill-action" disabled={Boolean(busy)} onClick={() => void runTests()}>{busy === 'tests' ? '돌리는 중…' : '시험 돌리기'}</button>
            </>
          ) : (
            onNavigate && <button type="button" className="skill-action primary" onClick={() => onNavigate('files')}>자료 스캔 열기</button>
          )}
        </div>
      </header>

      {problem && <p className="skill-toast bad" role="status">{problem}</p>}

      <section className="skill-card work-card" aria-label="스킬을 켜고 끈 기록">
        <header className="key-group-head">
          <h3>스킬을 켜고 끈 기록</h3>
          <small>{skillCount ? `최근 ${skillCount}개` : ''}</small>
        </header>
        {skills === null && <p className="skill-quiet">기록을 읽고 있어요.</p>}
        {skills && skills.length === 0 && <p className="skill-quiet">아직 기록이 없어요. 프로젝트 홈이나 스킬 보드에서 스킬을 켜고 끄면 여기에 남아요.</p>}
        {skills && skills.length > 0 && (
          <ul className="project-skill-list">
            {skills.map((change) => (
              <li key={change.id}>
                <span>{change.line}</span>
                <span className="skill-quiet">{whenText(change.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {root && (
        <section className="skill-card work-card" aria-label="바뀐 파일">
          <header className="key-group-head">
            <h3>바뀐 파일</h3>
            <small>{report?.checkedAt ? `${whenText(report.checkedAt)} 읽음` : ''}</small>
          </header>
          <p>{fileChangesHeadline(files, Boolean(report?.success))}</p>
          {fileGroups.filter(([, list]) => list.length > 0).map(([title, list]) => (
            <details key={title} className="skill-raw" open={list.length <= 8}>
              <summary>{title} {list.length}개</summary>
              <ul className="project-skill-list">
                {list.map((file) => <li key={file}><code>{file}</code></li>)}
              </ul>
            </details>
          ))}
          {report && (
            <details className="skill-raw">
              <summary>원문 보기</summary>
              <code>{root}</code>
              <pre className="output-panel">{report.status || '(git status: 바뀐 것 없음)'}</pre>
              {report.diff && <pre className="output-panel subtle-output">{report.diff}</pre>}
            </details>
          )}
        </section>
      )}

      {root && (
        <section className="skill-card work-card" aria-label="시험">
          <header className="key-group-head">
            <h3>시험</h3>
            <small>{tests?.checkedAt ? `${whenText(tests.checkedAt)} 돌림` : ''}</small>
          </header>
          <p className={tests ? (tests.success ? 'status-good' : 'status-bad') : ''}>{testHeadline(tests, busy === 'tests')}</p>
          {tests?.output && (
            <details className="skill-raw" open={!tests.success}>
              <summary>원문 보기</summary>
              <pre className={`output-panel ${tests.success ? 'output-good' : 'output-bad'}`}>{tests.output}</pre>
            </details>
          )}
        </section>
      )}
    </section>
  )
}
