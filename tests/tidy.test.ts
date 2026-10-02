import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { findRepos, parseStatusBranch, parseWorktrees, repoLeftovers, repoLine, repoNeedsAttention } from '../src/core/tidy/git-leftovers'
import { cronText, devSummary, headlessProcesses, intervalText, jobName, parseCrontab, parseCsv, parsePsList, parseProcessJson, parseSchtasksCsv, parseSystemdTimers, processLine } from '../src/core/tidy/background-jobs'
import { ageText, bytesText, findHeavyFolders, folderSize, heavyIsStale, heavyLine } from '../src/core/tidy/space-hogs'
import { emptyLine, tidyHeadline } from '../src/core/tidy/tidy-copy'
import type { RepoLeftover, Runner, TidyReport } from '../src/core/tidy/types'

const temps: string[] = []
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temps.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const cleanRepo: RepoLeftover = { repo: '/p/a', name: 'a', branch: 'main', changed: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true, worktrees: [], partOf: '', lastCommitAt: 0, failed: false }

describe('git leftovers', () => {
  it('finds project folders by .git and does not descend into them or node_modules', () => {
    const root = tempDir('dios-tidy-')
    fs.mkdirSync(path.join(root, 'Core', 'Dios', '.git'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Core', 'Dios', 'sub', '.git'), { recursive: true })
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg', '.git'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Other', 'plain'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Other', 'wt'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Other', 'wt', '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n')
    expect(findRepos([root]).sort()).toEqual([path.join(root, 'Core', 'Dios'), path.join(root, 'Other', 'wt')].sort())
    expect(findRepos([root, path.join(root, 'missing')])).toHaveLength(2)
    expect(findRepos([root], 1)).toEqual([])
  })

  it('reads porcelain v2 status with ahead/behind and counts', () => {
    const text = [
      '# branch.oid abc',
      '# branch.head master',
      '# branch.upstream origin/master',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 abc abc README.md',
      '1 A. N... 000000 100644 100644 abc abc new.ts',
      'u UU N... 100644 100644 100644 100644 a b c d conflict.ts',
      '? notes.txt',
      '! ignored.log',
    ].join('\n')
    expect(parseStatusBranch(text)).toEqual({ branch: 'master', hasUpstream: true, ahead: 2, behind: 1, changed: 3, untracked: 1 })
    expect(parseStatusBranch('# branch.head main\n')).toMatchObject({ hasUpstream: false, ahead: 0 })
  })

  it('reads worktree list and marks missing or prunable folders', () => {
    const text = [
      'worktree /home/u/proj',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /home/u/proj/.worktrees/feat',
      'HEAD bbb',
      'branch refs/heads/feat',
      '',
      'worktree /tmp/gone',
      'HEAD ccc',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n')
    const trees = parseWorktrees(text, (dir) => dir !== '/tmp/gone')
    expect(trees).toHaveLength(3)
    expect(trees[1]).toMatchObject({ path: '/home/u/proj/.worktrees/feat', branch: 'feat', prunable: false, exists: true })
    expect(trees[2]).toMatchObject({ branch: '(분리됨)', prunable: true, exists: false })
  })

  it('asks git through the runner and never throws', async () => {
    const calls: string[][] = []
    const run: Runner = async (_cmd, args) => {
      calls.push(args)
      if (args[0] === 'status') return { code: 0, stdout: '# branch.head dev\n? a.txt\n', stderr: '' }
      if (args[0] === 'worktree') return { code: 0, stdout: 'worktree /r\nHEAD x\nbranch refs/heads/dev\n\n', stderr: '' }
      return { code: 0, stdout: '1700000000\n', stderr: '' }
    }
    const row = await repoLeftovers(run, '/r')
    expect(row).toMatchObject({ name: 'r', branch: 'dev', untracked: 1, hasUpstream: false, worktrees: [], lastCommitAt: 1700000000000, failed: false })
    expect(calls[0]).toContain('--porcelain=v2')

    // A secondary copy points at its main folder and does not repeat the main folder's list.
    const copy: Runner = async (_cmd, args) => {
      if (args[0] === 'status') return { code: 0, stdout: '# branch.head feat\n', stderr: '' }
      if (args[0] === 'worktree') return { code: 0, stdout: 'worktree /main\nHEAD a\nbranch refs/heads/main\n\nworktree /main/.worktrees/feat\nHEAD b\nbranch refs/heads/feat\n\n', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const copyRow = await repoLeftovers(copy, '/main/.worktrees/feat')
    expect(copyRow).toMatchObject({ partOf: path.resolve('/main'), worktrees: [], lastCommitAt: 0 })
    const mainRow = await repoLeftovers(copy, '/main')
    expect(mainRow.partOf).toBe('')
    expect(mainRow.worktrees).toHaveLength(1)

    const broken: Runner = async () => { throw new Error('no git') }
    expect((await repoLeftovers(broken, '/r')).failed).toBe(true)
    const notRepo: Runner = async () => ({ code: 128, stdout: '', stderr: 'fatal' })
    expect((await repoLeftovers(notRepo, '/r')).failed).toBe(true)
  })

  it('writes the row line in plain Korean', () => {
    expect(repoLine(cleanRepo)).toBe('깨끗해요. 전부 저장했고 올렸어요.')
    expect(repoLine({ ...cleanRepo, hasUpstream: false })).toBe('깨끗해요. 올릴 곳(원격)은 없어요.')
    expect(repoLine({ ...cleanRepo, changed: 3, untracked: 1, ahead: 2 })).toBe('저장 안 한 수정 4개 · 올리지 않은 기록 2개')
    expect(repoLine({ ...cleanRepo, worktrees: [{ path: '/x', branch: 'f', prunable: true, exists: false }, { path: '/y', branch: 'g', prunable: false, exists: true }] }))
      .toBe('사라진 작업 폴더 1개 · 따로 꺼내 둔 작업 폴더 1개')
    expect(repoLine({ ...cleanRepo, failed: true })).toContain('git이 읽히지 않았어요')
    expect(repoNeedsAttention(cleanRepo)).toBe(false)
    expect(repoNeedsAttention({ ...cleanRepo, ahead: 1 })).toBe(true)
    expect(repoNeedsAttention({ ...cleanRepo, failed: true })).toBe(false)
  })
})

describe('background jobs', () => {
  it('parses quoted CSV', () => {
    expect(parseCsv('"a","b,c","say ""hi"""\r\n"1","2","3"\n')).toEqual([['a', 'b,c', 'say "hi"'], ['1', '2', '3']])
  })

  it('turns cron fields into Korean', () => {
    expect(cronText('*/5 * * * *')).toBe('5분마다')
    expect(cronText('0 */2 * * *')).toBe('2시간마다')
    expect(cronText('0 * * * *')).toBe('매시 정각')
    expect(cronText('30 9 * * *')).toBe('매일 9시 30분')
    expect(cronText('0 9 * * 1')).toBe('매주 월요일 9시')
    expect(cronText('0 9 * * 1-5')).toBe('평일 9시')
    expect(cronText('0 0 1 * *')).toBe('매달 1일 0시')
    expect(cronText('@reboot')).toBe('컴퓨터를 켤 때마다')
    expect(cronText('1 2 3 4 5 6')).toBe('1 2 3 4 5 6')
  })

  it('reads a crontab and names the job by its script', () => {
    const text = '# comment\nSHELL=/bin/bash\n\n0 9 * * * /usr/bin/python3 /home/u/night/notify.py >> /tmp/n.log 2>&1\n@daily bash ~/bin/backup.sh\n'
    const jobs = parseCrontab(text)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({ kind: 'cron', name: 'notify.py', schedule: '매일 9시', enabled: true })
    expect(jobs[1]).toMatchObject({ name: 'backup.sh', schedule: '매일 0시' })
    expect(jobName('cd /x && node server.js')).toBe('cd')
    expect(jobName('FOO=1 python3 -u run.py --fast')).toBe('run.py')
  })

  it('reads systemd timers from json and drops the ones the OS ships with', () => {
    const json = JSON.stringify([
      { next: 1700003600000000, left: 1700003600000000, last: 1700000000000000, passed: 0, unit: 'night.timer', activates: 'night.service' },
      { next: 1700086400000000, left: 0, last: 1700000000000000, passed: 0, unit: 'ubuntu-insights-upload.timer', activates: 'x.service' },
      { next: null, left: null, last: 1700000000000000, passed: 0, unit: 'old.timer', activates: 'old.service' },
      { unit: '' },
    ])
    const jobs = parseSystemdTimers(json)
    expect(jobs.map((job) => job.name)).toEqual(['night', 'old'])
    expect(jobs[0]).toMatchObject({ kind: 'systemd', command: 'night.service', schedule: '1시간마다', lastRunAt: 1700000000000, nextRunAt: 1700003600000, enabled: true })
    expect(jobs[1]).toMatchObject({ schedule: '예약됨', enabled: false })
    expect(intervalText(86_400_000)).toBe('하루에 한 번')
    expect(intervalText(7 * 86_400_000)).toBe('매주')
    expect(intervalText(5 * 60_000)).toBe('5분마다')
    expect(parseSystemdTimers('nope')).toEqual([])
  })

  it('reads schtasks CSV by column position and skips Microsoft tasks', () => {
    const header = Array.from({ length: 27 }, (_, index) => `col${index}`)
    const make = (name: string, status: string, type: string, start: string, days = 'N/A', repeat = 'N/A') => {
      const row = Array.from({ length: 27 }, () => '')
      row[0] = 'PC'
      row[1] = name
      row[2] = '2026-10-03 오전 9:00:00'
      row[3] = status
      row[5] = '2026-10-02 오전 9:00:00'
      row[8] = 'py C:\\night\\run.py'
      row[18] = type
      row[19] = start
      row[22] = days
      row[24] = repeat
      return row.map((cell) => `"${cell}"`).join(',')
    }
    const csv = [header.map((cell) => `"${cell}"`).join(','), make('\\Microsoft\\Windows\\Defrag', '준비', '매일', '09:00:00'), make('\\AgentRelayNight', '준비', '매일', '09:00:00'), make('\\OldSync', '사용 안 함', '매주', '18:30:00', 'MON, FRI')].join('\r\n')
    const jobs = parseSchtasksCsv(csv)
    expect(jobs.map((job) => job.name)).toEqual(['AgentRelayNight', 'OldSync'])
    expect(jobs[0]).toMatchObject({ kind: 'schtasks', schedule: '매일 09:00', command: 'py C:\\night\\run.py', enabled: true })
    expect(jobs[0].nextRunAt).toBeGreaterThan(0)
    expect(jobs[1]).toMatchObject({ schedule: '매주 MON, FRI 18:30', enabled: false })
  })

  it('tells dev servers apart from everything else', () => {
    expect(devSummary('node /x/node_modules/.bin/vite --port 5173')).toBe('vite 개발 서버 · 포트 5173')
    expect(devSummary('python3 -m http.server 4798 --bind 127.0.0.1')).toBe('간단 웹 서버 (python http.server) · 포트 4798')
    expect(devSummary('npm run dev')).toBe('개발 서버 (npm 계열)')
    expect(devSummary('node /x/node_modules/.bin/vite build')).toBe('')
    expect(devSummary('/usr/lib/firefox/firefox')).toBe('')
    expect(devSummary('')).toBe('')
  })

  it('lists headless processes without DIOS itself and without child duplicates', () => {
    const now = 1_700_000_000_000
    const ps = [
      '  100     1  86500 204800 node /app/node_modules/.bin/vite',
      '  101   100    100  10240 /usr/bin/esbuild --service',
      '  200     1   3600  51200 python3 -m http.server 4798',
      '  300     1     60  10000 /opt/dios/dios',
      '  301   300     50  20000 npm run dev',
      '  400     1     10   5000 /usr/bin/bash',
    ].join('\n')
    const raw = parsePsList(ps, now)
    expect(raw[0]).toMatchObject({ pid: 100, ppid: 1, name: 'node', rssBytes: 204800 * 1024, startedAt: now - 86500 * 1000 })
    const rows = headlessProcesses(raw, { ownPids: [300], cwdOf: (pid) => (pid === 200 ? '/tmp/dios-preview' : '') })
    expect(rows.map((row) => row.pid)).toEqual([100, 200])
    expect(rows[1].cwd).toBe('/tmp/dios-preview')
    expect(processLine(rows[0], now)).toBe('1일째 켜져 있어요 · 메모리 200MB')
    expect(processLine(rows[1], now)).toBe('1시간째 켜져 있어요 · 메모리 50MB · /tmp/dios-preview')
  })

  it('reads the PowerShell process json', () => {
    const rows = parseProcessJson(JSON.stringify({ pid: 12, ppid: 1, name: 'node.exe', args: 'node vite', startedAt: 5, rssBytes: 1024 }))
    expect(rows).toEqual([{ pid: 12, ppid: 1, name: 'node', args: 'node vite', startedAt: 5, rssBytes: 1024, cwd: undefined }])
    expect(parseProcessJson('[')).toEqual([])
  })
})

describe('space hogs', () => {
  it('sizes folders with a budget and finds heavy folders under projects', () => {
    const root = tempDir('dios-heavy-')
    const proj = path.join(root, 'app')
    fs.mkdirSync(path.join(proj, 'node_modules', 'a'), { recursive: true })
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true })
    fs.writeFileSync(path.join(proj, 'package.json'), '{}')
    fs.writeFileSync(path.join(proj, 'node_modules', 'a', 'big.bin'), Buffer.alloc(3 * 1024 * 1024))
    fs.writeFileSync(path.join(proj, 'node_modules', 'a', 'small.js'), 'x')
    fs.mkdirSync(path.join(proj, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(proj, 'dist', 'bundle.js'), 'y')
    const size = folderSize(path.join(proj, 'node_modules'))
    expect(size).toEqual({ bytes: 3 * 1024 * 1024 + 1, files: 2, approx: false })
    expect(folderSize(path.join(proj, 'node_modules'), 1)).toMatchObject({ files: 1, approx: true })

    const rows = findHeavyFolders([root], { minBytes: 1024 * 1024 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'node_modules', project: proj, files: 2 })
    expect(rows[0].projectTouchedAt).toBeGreaterThan(0)
    expect(findHeavyFolders([root], { minBytes: 0 }).map((row) => row.kind)).toEqual(['node_modules', 'build'])
  })

  it('writes sizes and ages in plain Korean', () => {
    expect(bytesText(10)).toBe('1MB 미만')
    expect(bytesText(512 * 1048576)).toBe('약 512MB')
    expect(bytesText(2.34 * 1073741824)).toBe('약 2.3GB')
    expect(bytesText(12 * 1073741824, true)).toBe('적어도 12GB')
    const now = 1_700_000_000_000
    expect(ageText(now - 3 * 86_400_000, now)).toBe('3일 전')
    expect(ageText(now - 70 * 86_400_000, now)).toBe('2달 전')
    expect(ageText(now - 400 * 86_400_000, now)).toBe('1년 넘게 전')
    expect(ageText(0, now)).toBe('언제인지 몰라요')
    const row = { path: '/p/node_modules', kind: 'node_modules' as const, project: '/p', bytes: 1073741824, files: 10, approx: false, projectTouchedAt: now - 90 * 86_400_000 }
    expect(heavyLine(row, now)).toBe('약 1GB · 프로젝트는 3달 전에 마지막으로 손댔어요 · 지워도 npm install로 다시 생겨요')
    expect(heavyIsStale(row, now)).toBe(true)
    expect(heavyIsStale({ ...row, projectTouchedAt: now }, now)).toBe(false)
    expect(heavyLine({ ...row, kind: 'temp', project: '' }, now)).toContain('잠깐 쓰고 두고 간')
    expect(heavyLine({ ...row, kind: 'build', projectTouchedAt: now }, now)).toBe('약 1GB · 프로젝트는 오늘 마지막으로 손댔어요 · 다시 빌드하면 생겨요')
  })
})

describe('tidy copy', () => {
  const empty: TidyReport = { scannedAt: 0, roots: [], repos: [], jobs: [], processes: [], heavy: [], notes: [] }
  it('says what needs eyes in one sentence', () => {
    expect(tidyHeadline(empty)).toBe('아직 살펴보지 않았어요.')
    expect(tidyHeadline({ ...empty, scannedAt: 1 })).toBe('지금은 정리할 게 없어요. 깨끗해요.')
    const busy: TidyReport = {
      ...empty,
      scannedAt: 1,
      repos: [{ ...cleanRepo, changed: 2 }, cleanRepo, { ...cleanRepo, worktrees: [{ path: '/w', branch: 'x', prunable: false, exists: true }] }],
      processes: [{ pid: 1, ppid: 0, name: 'node', summary: 'vite', args: '', cwd: '', startedAt: 0, rssBytes: 0 }],
      jobs: [{ kind: 'cron', name: 'a', schedule: '매일 9시', command: 'a', lastRunAt: 0, nextRunAt: 0, enabled: true }],
      heavy: [{ path: '/x', kind: 'node_modules', project: '/p', bytes: 6 * 1073741824, files: 1, approx: false, projectTouchedAt: 0 }],
    }
    expect(tidyHeadline(busy)).toBe('저장 안 한 수정이 있는 프로젝트 1곳, 창 없이 켜져 있는 프로그램 1개, 혼자 도는 예약 작업 1개, 비울 수 있는 자리 약 6GB예요.')
    expect(emptyLine('repos', 0)).toContain('API 키 관리')
  })
})
