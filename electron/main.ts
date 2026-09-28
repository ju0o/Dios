import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, safeStorage, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import { runQuiet, setQuietHost } from '../src/core/skill-board/quiet-process'
import { COPY_FOLDER, REVIEW_FOLDER } from '../src/core/skill-board/skill-export'
import { initDatabase, getDatabase } from './db/schema'
import { autoUpdater } from 'electron-updater'
import { explainUpdateError, initialUpdateState, type UpdateState } from '../src/core/update/update-copy'
import { BLURB_START_MS, createBlurbQueue, pendingBlurbNames, type BlurbProgress } from '../src/core/skill-library/blurb-queue'
import { releaseNoteLines } from '../src/core/update/whats-new'
import releaseNotesRaw from '../release-notes.md?raw'

let mainWindow: BrowserWindow | null = null
let databasePath = ''

function recordActivity(type: string, title: string, description = '') {
  try {
    getDatabase().prepare('INSERT INTO activity_events (id, type, title, description, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), type, title, description, Date.now())
  } catch {
    // Activity recording must never block the primary operation.
  }
}

function backupDirectory() {
  const directory = path.join(app.getPath('userData'), 'backups')
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function createDatabaseBackup() {
  getDatabase().pragma('wal_checkpoint(TRUNCATE)')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDirectory(), `dios-${timestamp}.db`)
  fs.copyFileSync(databasePath, backupPath)
  pruneBackups()
  recordActivity('backup', 'DIOS 데이터 백업 생성', path.basename(backupPath))
  return backupPath
}

function pruneBackups() {
  let retentionDays = 30
  try {
    const row = getDatabase().prepare('SELECT value_json FROM app_settings WHERE key = ?').get('app') as { value_json?: string } | undefined
    if (row?.value_json) retentionDays = Math.max(1, Number(JSON.parse(row.value_json).backupRetentionDays) || 30)
  } catch {
    // Use the safe default when settings are unavailable.
  }
  const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  for (const name of fs.readdirSync(backupDirectory())) {
    if (!name.toLowerCase().endsWith('.db')) continue
    const filePath = path.join(backupDirectory(), name)
    if (fs.statSync(filePath).mtimeMs < threshold) {
      try { fs.unlinkSync(filePath) } catch { /* keep an undeletable backup */ }
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'DIOS',
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  const openedAt = Date.now()
  setQuietHost({
    wasFocused() {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win || win.isDestroyed()) return false
      return win.isFocused() || Date.now() - openedAt < 8000
    },
    pullForward() {
      const win = mainWindow
      if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible() || win.isFocused()) return
      win.show()
      win.focus()
    },
  })
  const dbPath = path.join(app.getPath('userData'), 'dios.db')
  databasePath = dbPath
  initDatabase(dbPath)
  createWindow()
  startDriftWatch()
  startWorkWatch()
  startUpdateWatch()
  startBlurbWatch()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

/**
 * Compare skill text once, a little after start, and tell the window how many differ.
 * There is no loop: the skill board asks again when it opens.
 */
function startDriftWatch(): void {
  setTimeout(() => {
    void (async () => {
      try {
        const { countDrift } = await import('../src/core/skill-board/board-service')
        const count = await countDrift('local')
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('skillBoard:drift', { count })
        }
        if (count > 0) notifyOnce('drift', '스킬 글이 다른 곳이 있어요.', `${count}곳이 공용 폴더와 달라요. 스킬 보드에서 맞출 수 있어요.`, 'skillBoard')
      } catch {
        // A computer that is off stays quiet. The last badge remains.
      }
    })()
  }, 45_000)
  setTimeout(() => { void publishUsageAlerts() }, 20_000)
}

/** Badge for 사용량 from the cache of the last read only; the logs themselves are read when the tab opens. */
async function publishUsageAlerts(): Promise<void> {
  try {
    const { readCachedUsage } = await import('../src/core/agent-monitor/local-logs')
    const { countUsageAlerts } = await import('../src/core/agent-monitor/usage-summary')
    const counts = countUsageAlerts([{ place: '이 컴퓨터', ok: true, problem: '', entries: readCachedUsage(os.homedir()) }], readUsageCaps())
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('usage:alerts', { count: counts.alerts, over: counts.over })
    }
    if (counts.over > 0) notifyOnce('usage-over', '정해 둔 금액을 넘었어요.', '사용량 화면에서 어디가 넘었는지 볼 수 있어요.', 'agentMonitor')
  } catch {
    // No cache yet means no badge.
  }
}

// ═══════════════════════════════════════════
// 업데이트: GitHub Releases. Checked on the button, and once quietly after start.
// ═══════════════════════════════════════════
let updateState: UpdateState = initialUpdateState(app.getVersion(), app.isPackaged)
let updaterWired = false

function pushUpdate(next: Partial<UpdateState>): void {
  updateState = { ...updateState, ...next }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:state', updateState)
  }
}

function wireUpdater(): void {
  if (updaterWired) return
  updaterWired = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => pushUpdate({ phase: 'checking', detail: '' }))
  autoUpdater.on('update-not-available', () => pushUpdate({ phase: 'none', next: '', percent: 0 }))
  autoUpdater.on('update-available', (info) => pushUpdate({ phase: 'available', next: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (progress) => pushUpdate({ phase: 'downloading', percent: progress.percent }))
  autoUpdater.on('update-downloaded', (info) => {
    pushUpdate({ phase: 'ready', next: info.version, percent: 100 })
    notifyOnce('update-ready', `DIOS ${info.version} 준비됐어요.`, '왼쪽 아래 버튼을 누르면 다시 시작하면서 적용돼요.', 'settings')
  })
  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error)
    pushUpdate({ phase: 'error', detail: explainUpdateError(message) + `\n${message}` })
  })
}

async function checkForUpdate(quiet: boolean): Promise<UpdateState> {
  if (!app.isPackaged) return updateState
  wireUpdater()
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (quiet) pushUpdate({ phase: 'idle', detail: '' })
    else pushUpdate({ phase: 'error', detail: explainUpdateError(message) + `\n${message}` })
  }
  return updateState
}

ipcMain.handle('update:state', () => updateState)
ipcMain.handle('update:whatsNew', () => ({ version: app.getVersion(), lines: releaseNoteLines(releaseNotesRaw) }))
ipcMain.handle('update:check', () => checkForUpdate(false))
ipcMain.handle('update:download', async () => {
  if (!app.isPackaged || updateState.phase !== 'available') return updateState
  wireUpdater()
  try {
    pushUpdate({ phase: 'downloading', percent: 0 })
    await autoUpdater.downloadUpdate()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushUpdate({ phase: 'error', detail: explainUpdateError(message) + `\n${message}` })
  }
  return updateState
})
ipcMain.handle('update:install', () => {
  if (updateState.phase !== 'ready') return updateState
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return updateState
})

function startUpdateWatch(): void {
  if (!app.isPackaged) return
  setTimeout(() => { void checkForUpdate(true) }, 90_000)
}

let blurbChain: Promise<unknown> = Promise.resolve()
let blurbQueue: ReturnType<typeof createBlurbQueue> | null = null

/** One Korean sentence at a time, so a button press and the background pass never overlap. */
function translateOne(name: string): Promise<{ ok: boolean; message: string; korean: string }> {
  const job = blurbChain.then(async () => {
    const { translateCard } = await import('../src/core/skill-library/library-service')
    return translateCard(String(name || ''), connectedSkillRoots())
  })
  blurbChain = job.then(() => undefined, () => undefined)
  return job
}

function broadcastBlurb(progress: BlurbProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('library:blurb', progress)
  }
}

/** Prepare missing Korean sentences slowly after the app is open. A press of 멈추기 ends the pass. */
function startBlurbWatch(): void {
  blurbQueue = createBlurbQueue({
    listPending: async () => {
      const { listLibrary } = await import('../src/core/skill-library/library-service')
      return pendingBlurbNames(listLibrary(connectedSkillRoots()).skills)
    },
    translate: translateOne,
  })
  blurbQueue.subscribe(broadcastBlurb)
  setTimeout(() => blurbQueue?.start(), BLURB_START_MS)
}

const notified = new Set<string>()

/** One desktop notice per kind, per launch. Quiet when the computer can't show one. */
function notifyOnce(kind: string, title: string, body: string, view: string): void {
  if (notified.has(kind) || !Notification.isSupported()) return
  notified.add(kind)
  try {
    const note = new Notification({ title, body })
    note.on('click', () => {
      const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('app:open', view)
    })
    note.show()
  } catch {
    // A missing notification service must not affect the app.
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ═══════════════════════════════════════════
// Projects
// ═══════════════════════════════════════════
ipcMain.handle('project:list', async () => {
  const db = getDatabase()
  return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all()
})

ipcMain.handle('project:create', async (_event, project: any) => {
  const db = getDatabase()
  const id = project.id || crypto.randomUUID()
  const now = Date.now()
  db.prepare(`
    INSERT INTO projects (id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(id, project.name, project.description, now, now)
  return { id, ...project }
})

ipcMain.handle('project:update', async (_event, project: any) => {
  const db = getDatabase()
  try {
    const now = Date.now()
    db.prepare(`
      UPDATE projects 
      SET name = ?, description = ?, updated_at = ?
      WHERE id = ?
    `).run(project.name, project.description, now, project.id)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('project:delete', async (_event, projectId: string) => {
  const db = getDatabase()
  try {
    db.prepare('DELETE FROM documents WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

// ═══════════════════════════════════════════
// Documents
// ═══════════════════════════════════════════
ipcMain.handle('document:list', async (_event, projectId: string) => {
  const db = getDatabase()
  return db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
})

ipcMain.handle('document:save', async (_event, doc: any) => {
  const db = getDatabase()
  const id = doc.id || crypto.randomUUID()
  const now = Date.now()
  db.prepare(`
    INSERT OR REPLACE INTO documents (id, project_id, title, content, type, file_path, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, doc.projectId, doc.title, doc.content, doc.type, doc.filePath || null, now)
  return { id, ...doc }
})

ipcMain.handle('document:update', async (_event, doc: any) => {
  const db = getDatabase()
  try {
    const now = Date.now()
    db.prepare(`
      UPDATE documents 
      SET title = ?, content = ?, type = ?, updated_at = ?
      WHERE id = ?
    `).run(doc.title, doc.content, doc.type, now, doc.id)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('document:delete', async (_event, documentId: string) => {
  const db = getDatabase()
  try {
    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

// ═══════════════════════════════════════════
// Files
// ═══════════════════════════════════════════
ipcMain.handle('file:delete', async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return { success: true }
    }
    return { success: false, error: '파일이 존재하지 않습니다' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

// ═══════════════════════════════════════════
// Scanner
// ═══════════════════════════════════════════
ipcMain.handle('scan:roots', async (_event, roots: string[]) => {
  const { scanRoots } = await import('../src/core/scanner/scanner')
  const result = await scanRoots(roots)
  recordActivity('scan', '폴더 스캔 완료', `${roots.length}개 폴더 · ${result.length}개 파일`)
  return result
})

ipcMain.handle('project:runbook:get', async (_event, projectId: string) => {
  const row = getDatabase().prepare('SELECT content, updated_at as updatedAt FROM project_runbooks WHERE project_id = ?').get(projectId) as { content?: string; updatedAt?: number } | undefined
  return { projectId, content: row?.content || '', updatedAt: row?.updatedAt || null }
})

ipcMain.handle('project:runbook:save', async (_event, projectId: string, content: string) => {
  const updatedAt = Date.now()
  getDatabase().prepare(`
    INSERT INTO project_runbooks (project_id, content, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(projectId, content || '', updatedAt)
  recordActivity('runbook', '프로젝트 운영지침 저장', projectId)
  return { projectId, content: content || '', updatedAt }
})

ipcMain.handle('project:connections:list', async (_event, projectId: string) => {
  return getDatabase().prepare(`
    SELECT id, project_id as projectId, kind, label, path, created_at as createdAt, updated_at as updatedAt
    FROM project_connections WHERE project_id = ? ORDER BY kind, label, path
  `).all(projectId)
})

ipcMain.handle('project:connections:save', async (_event, input: any) => {
  if (!input?.projectId || !input?.path?.trim()) return { success: false, error: '프로젝트와 폴더 경로를 입력하세요.' }
  const kind = ['folder', 'skills', 'memory'].includes(input.kind) ? input.kind : 'folder'
  const project = getDatabase().prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId)
  if (!project) return { success: false, error: '프로젝트를 찾을 수 없습니다.' }
  const timestamp = Date.now()
  const id = input.id || crypto.randomUUID()
  getDatabase().prepare(`
    INSERT INTO project_connections (id, project_id, kind, label, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, kind, path) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at
  `).run(id, input.projectId, kind, input.label?.trim() || '', input.path.trim(), timestamp, timestamp)
  recordActivity('project', '프로젝트 자료 연결 저장', `${kind} · ${input.path.trim()}`)
  const connections = getDatabase().prepare(`
    SELECT id, project_id as projectId, kind, label, path, created_at as createdAt, updated_at as updatedAt
    FROM project_connections WHERE project_id = ? ORDER BY kind, label, path
  `).all(input.projectId)
  return { success: true, connections }
})

ipcMain.handle('project:connections:delete', async (_event, id: string) => {
  getDatabase().prepare('DELETE FROM project_connections WHERE id = ?').run(id)
  recordActivity('project', '프로젝트 자료 연결 삭제', id)
  return { success: true }
})

ipcMain.handle('project:export', async (_event, projectId: string) => {
  const db = getDatabase()
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any
  if (!project) return { success: false, error: '프로젝트를 찾을 수 없습니다.' }
  const runbook = db.prepare('SELECT content, updated_at as updatedAt FROM project_runbooks WHERE project_id = ?').get(projectId) || { content: '' }
  const documents = db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
  const connections = db.prepare('SELECT kind, label, path FROM project_connections WHERE project_id = ? ORDER BY kind, label, path').all(projectId)
  const result = await dialog.showSaveDialog({
    title: '프로젝트 내보내기',
    defaultPath: path.join(app.getPath('documents'), `${project.name.replace(/[\\/:*?"<>|]/g, '_')}.dios-project.json`),
    filters: [{ name: 'DIOS Project', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { success: false, canceled: true }
  fs.writeFileSync(result.filePath, JSON.stringify({ version: 2, exportedAt: Date.now(), project, runbook, documents, connections }, null, 2), 'utf-8')
  recordActivity('project', '프로젝트 내보내기 완료', path.basename(result.filePath))
  return { success: true, path: result.filePath }
})

ipcMain.handle('project:import', async () => {
  const result = await dialog.showOpenDialog({ title: 'DIOS 프로젝트 가져오기', properties: ['openFile'], filters: [{ name: 'DIOS Project', extensions: ['json'] }] })
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true }
  try {
    const payload = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'))
    if (!payload?.project?.name) return { success: false, error: 'DIOS 프로젝트 파일 형식이 아닙니다.' }
    const db = getDatabase()
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, `${payload.project.name} (가져옴)`, payload.project.description || '', 'active', now, now)
    const insertDocument = db.prepare('INSERT INTO documents (id, project_id, title, content, type, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const document of Array.isArray(payload.documents) ? payload.documents : []) {
      insertDocument.run(crypto.randomUUID(), id, document.title || '가져온 문서', document.content || '', document.type || 'markdown', document.file_path || null, now, now)
    }
    if (payload.runbook?.content) db.prepare('INSERT INTO project_runbooks (project_id, content, updated_at) VALUES (?, ?, ?)').run(id, payload.runbook.content, now)
    const insertConnection = db.prepare('INSERT OR IGNORE INTO project_connections (id, project_id, kind, label, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const connection of Array.isArray(payload.connections) ? payload.connections : []) {
      if (connection?.path) insertConnection.run(crypto.randomUUID(), id, ['folder', 'skills', 'memory'].includes(connection.kind) ? connection.kind : 'folder', connection.label || '', connection.path, now, now)
    }
    recordActivity('project', '프로젝트 가져오기 완료', payload.project.name)
    return { success: true, project: { id, name: `${payload.project.name} (가져옴)`, description: payload.project.description || '' } }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('search:documents', async (_event, query: string, filters?: any) => {
  const { searchDocuments } = await import('../src/core/store/document-store')
  return searchDocuments(query, filters)
})

// ═══════════════════════════════════════════
// Graph
// ═══════════════════════════════════════════
ipcMain.handle('graph:get', async () => {
  const { getGraphData } = await import('../src/core/graph/graph-builder')
  return getGraphData()
})

// ═══════════════════════════════════════════
// Experiments
// ═══════════════════════════════════════════
ipcMain.handle('experiment:create', async (_event, input: any) => {
  const { createExperiment } = await import('../src/core/experiment/experiment-store')
  return createExperiment(input)
})

ipcMain.handle('experiment:get', async (_event, id: string) => {
  const { getExperiment } = await import('../src/core/experiment/experiment-store')
  return getExperiment(id)
})

ipcMain.handle('experiment:list', async () => {
  const { listExperiments } = await import('../src/core/experiment/experiment-store')
  return listExperiments()
})

ipcMain.handle('experiment:transition', async (_event, input: any) => {
  const { transitionExperiment } = await import('../src/core/experiment/experiment-store')
  return transitionExperiment(input)
})

ipcMain.handle('experiment:transitions', async (_event, experimentId: string) => {
  const { listTransitions } = await import('../src/core/experiment/experiment-store')
  return listTransitions(experimentId)
})

// ═══════════════════════════════════════════
// Decision Ledger
// ═══════════════════════════════════════════
ipcMain.handle('decision:create', async (_event, input: any) => {
  const { createDecisionEntry } = await import('../src/core/decision/decision-ledger-store')
  return createDecisionEntry(input)
})

ipcMain.handle('decision:list', async () => {
  const { listDecisionEntries } = await import('../src/core/decision/decision-ledger-store')
  return listDecisionEntries()
})

ipcMain.handle('decision:get', async (_event, id: string) => {
  const { getDecisionEntry } = await import('../src/core/decision/decision-ledger-store')
  return getDecisionEntry(id)
})

ipcMain.handle('decision:verify', async () => {
  const { verifyChainIntegrity } = await import('../src/core/decision/decision-ledger-store')
  return verifyChainIntegrity()
})

// ═══════════════════════════════════════════
// Human Gate
// ═══════════════════════════════════════════
ipcMain.handle('humanGate:create', async (_event, input: any) => {
  const { createHumanGate } = await import('../src/core/human-gate/human-gate-store')
  return createHumanGate(input)
})

ipcMain.handle('humanGate:list', async () => {
  const { listHumanGates } = await import('../src/core/human-gate/human-gate-store')
  return listHumanGates()
})

ipcMain.handle('humanGate:seed', async () => {
  const { seedDefaultGates } = await import('../src/core/human-gate/human-gate-store')
  return seedDefaultGates()
})

ipcMain.handle('humanGate:requestChange', async (_event, input: any) => {
  const { requestThresholdChange } = await import('../src/core/human-gate/human-gate-store')
  return requestThresholdChange(input)
})

ipcMain.handle('humanGate:approveChange', async (_event, input: any) => {
  const { approveThresholdChange } = await import('../src/core/human-gate/human-gate-store')
  return approveThresholdChange(input)
})

ipcMain.handle('humanGate:pendingEvents', async () => {
  const { listPendingEvents } = await import('../src/core/human-gate/human-gate-store')
  return listPendingEvents()
})

ipcMain.handle('humanGate:setEnabled', async (_event, gateId: string, enabled: boolean, requestedBy: string) => {
  const { setGateEnabled } = await import('../src/core/human-gate/human-gate-store')
  return setGateEnabled(gateId, enabled, requestedBy)
})

// ═══════════════════════════════════════════
// AI Resources
// ═══════════════════════════════════════════
ipcMain.handle('aiResource:list', async () => {
  const { listAIResources } = await import('../src/core/ai-resource/ai-resource-store')
  return listAIResources()
})

ipcMain.handle('aiResource:get', async (_event, id: string) => {
  const { getAIResource } = await import('../src/core/ai-resource/ai-resource-store')
  return getAIResource(id)
})

ipcMain.handle('aiResource:create', async (_event, input: any) => {
  const { createAIResource } = await import('../src/core/ai-resource/ai-resource-store')
  return createAIResource(input)
})

ipcMain.handle('aiResource:update', async (_event, id: string, input: any) => {
  const { updateAIResource } = await import('../src/core/ai-resource/ai-resource-store')
  return updateAIResource(id, input)
})

ipcMain.handle('aiResource:recordUsage', async (_event, input: any) => {
  const { recordUsage } = await import('../src/core/ai-resource/ai-resource-store')
  return recordUsage(input)
})

ipcMain.handle('aiResource:resetMonthly', async (_event, resourceId: string) => {
  const { resetMonthlyUsage } = await import('../src/core/ai-resource/ai-resource-store')
  return resetMonthlyUsage(resourceId)
})

ipcMain.handle('aiResource:usageHistory', async (_event, resourceId: string) => {
  const { getUsageHistory } = await import('../src/core/ai-resource/ai-resource-store')
  return getUsageHistory(resourceId)
})

// ═══════════════════════════════════════════
// Agent Monitor (구독 AI 서비스 사용량 추적)
// ═══════════════════════════════════════════
ipcMain.handle('agentMonitor:listServices', async () => {
  const { listAgentServices } = await import('../src/core/agent-monitor/agent-monitor-store')
  return listAgentServices()
})

ipcMain.handle('agentMonitor:createService', async (_event, input: any) => {
  const { createAgentService } = await import('../src/core/agent-monitor/agent-monitor-store')
  return createAgentService(input)
})

ipcMain.handle('agentMonitor:updateService', async (_event, id: string, input: any) => {
  const { updateAgentService } = await import('../src/core/agent-monitor/agent-monitor-store')
  return updateAgentService(id, input)
})

ipcMain.handle('agentMonitor:deleteService', async (_event, id: string) => {
  const { deleteAgentService } = await import('../src/core/agent-monitor/agent-monitor-store')
  return deleteAgentService(id)
})

ipcMain.handle('agentMonitor:fetchAllUsage', async () => {
  const { fetchAllUsage } = await import('../src/core/agent-monitor/agent-monitor-store')
  return fetchAllUsage()
})

ipcMain.handle('agentMonitor:getCachedUsage', async () => {
  const { getCachedUsage } = await import('../src/core/agent-monitor/agent-monitor-store')
  return getCachedUsage()
})

ipcMain.handle('agentMonitor:countFiles', async () => {
  const { countLocalFiles } = await import('../src/core/agent-monitor/agent-monitor-store')
  return countLocalFiles()
})

// ═══════════════════════════════════════════
// 스킬 라이브러리: every skill on this computer, plus adding from the web, a folder, or another computer
// ═══════════════════════════════════════════
function connectedSkillRoots(): string[] {
  try {
    return (getDatabase().prepare("SELECT DISTINCT path FROM project_connections WHERE kind = 'skills'").all() as Array<{ path: string }>).map((row) => row.path)
  } catch {
    return []
  }
}

ipcMain.handle('library:list', async () => {
  const { listLibrary } = await import('../src/core/skill-library/library-service')
  return listLibrary(connectedSkillRoots())
})

ipcMain.handle('library:preview', async (_event, address: string) => {
  const { previewSkill } = await import('../src/core/skill-library/library-service')
  return previewSkill(String(address || ''))
})

ipcMain.handle('library:add', async (_event, candidate: import('../src/core/skill-library/fetch-skill').SkillCandidate, agentIds: string[] | null) => {
  const { addCandidate } = await import('../src/core/skill-library/library-service')
  const result = addCandidate(candidate, Array.isArray(agentIds) ? agentIds.map(String) : null, connectedSkillRoots())
  if (result.ok) recordActivity('skill', '스킬 받기', candidate.name)
  return result
})

ipcMain.handle('library:addFolder', async (_event, agentIds: string[] | null) => {
  const { addFolder } = await import('../src/core/skill-library/library-service')
  const picked = await dialog.showOpenDialog({ title: '스킬 폴더 고르기 (SKILL.md가 들어 있는 폴더)', properties: ['openDirectory'] })
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, message: '', listing: null }
  const result = addFolder(picked.filePaths[0], Array.isArray(agentIds) ? agentIds.map(String) : null, connectedSkillRoots())
  if (result.ok) recordActivity('skill', '스킬 폴더 추가', picked.filePaths[0])
  return result
})

ipcMain.handle('library:attach', async (_event, name: string, agentIds: string[]) => {
  const { attachSkill } = await import('../src/core/skill-library/library-service')
  return attachSkill(String(name || ''), Array.isArray(agentIds) ? agentIds.map(String) : [], connectedSkillRoots())
})

ipcMain.handle('library:adopt', async (_event, name: string, from: string, agentIds: string[] | null) => {
  const { adoptSkill } = await import('../src/core/skill-library/library-service')
  return adoptSkill(String(name || ''), String(from || ''), Array.isArray(agentIds) ? agentIds.map(String) : null, connectedSkillRoots())
})

ipcMain.handle('library:remotes', async () => {
  const { remoteSkills } = await import('../src/core/skill-library/library-service')
  return remoteSkills()
})

ipcMain.handle('library:take', async (_event, placeId: string, name: string) => {
  const { takeFromPlace } = await import('../src/core/skill-library/library-service')
  const result = await takeFromPlace(String(placeId || ''), String(name || ''), connectedSkillRoots())
  if (result.ok) recordActivity('skill', '다른 컴퓨터에서 스킬 가져오기', name)
  return result
})

ipcMain.handle('library:blurb', async (_event, name: string) => translateOne(name))

ipcMain.handle('library:blurbState', () => blurbQueue?.state() ?? { phase: 'idle', done: 0, total: 0, name: '', korean: '', message: '' })

ipcMain.handle('library:blurbPause', () => {
  blurbQueue?.pause()
  return blurbQueue?.state() ?? { phase: 'paused', done: 0, total: 0, name: '', korean: '', message: '한글 설명을 멈췄어요.' }
})

ipcMain.handle('project:relayList', async () => {
  const { relayProjects } = await import('../src/core/skill-board/project-skill-switch')
  return relayProjects(os.homedir())
})

ipcMain.handle('project:skills', async (_event, projectName: string) => {
  const { listProjectSkills } = await import('../src/core/skill-board/project-skill-switch')
  return listProjectSkills(os.homedir(), String(projectName || ''), connectedSkillRoots())
})

ipcMain.handle('project:skillSet', async (_event, projectName: string, skillName: string, on: boolean) => {
  const { setProjectSkill } = await import('../src/core/skill-board/project-skill-switch')
  const result = setProjectSkill(os.homedir(), String(projectName || ''), String(skillName || ''), Boolean(on), connectedSkillRoots())
  if (result.matched && (result.message.includes('붙였어요') || result.message.includes('뺐어요'))) {
    recordActivity('skill', on ? '프로젝트에 스킬 붙이기' : '프로젝트에서 스킬 빼기', String(skillName || ''))
  }
  return result
})

ipcMain.handle('library:gather', async () => {
  const { gatherLoose } = await import('../src/core/skill-library/library-service')
  const result = gatherLoose(connectedSkillRoots())
  if (result.ok && result.message && !result.message.startsWith('모을 수 있는')) recordActivity('skill', '스킬 모으기', result.message)
  return result
})

ipcMain.handle('start:look', async () => {
  const { listLibrary, isGatherable } = await import('../src/core/skill-library/library-service')
  const { defaultReportRoot } = await import('../src/core/founder-work/read-report')
  const listing = listLibrary(connectedSkillRoots())
  return {
    founder: Boolean(defaultReportRoot(process.platform)),
    agents: listing.readyAgents.map((agent) => agent.name),
    skillCount: listing.skills.length,
    looseCount: listing.skills.filter(isGatherable).length,
    newCount: listing.skills.filter((skill) => skill.isNew).length,
  }
})

ipcMain.handle('usage:today', async (_event, projectLabel: string) => {
  const { readCachedUsage, usageCachePath } = await import('../src/core/agent-monitor/local-logs')
  const { todaySentence } = await import('../src/core/agent-monitor/usage-summary')
  const home = os.homedir()
  if (!fs.existsSync(usageCachePath(home))) return { line: '사용량 화면을 한 번 열면 오늘 한 일이 여기도 나와요.' }
  const now = new Date()
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return { line: todaySentence(readCachedUsage(home), day, String(projectLabel || '')) }
})

ipcMain.handle('usage:week', async (_event, projectLabel: string) => {
  const { readCachedUsage, usageCachePath } = await import('../src/core/agent-monitor/local-logs')
  const { weekGraph } = await import('../src/core/agent-monitor/usage-summary')
  const home = os.homedir()
  if (!fs.existsSync(usageCachePath(home))) return null
  return weekGraph(readCachedUsage(home), new Date(), String(projectLabel || ''))
})

ipcMain.handle('library:openFolder', async (_event, folder: string) => {
  const target = String(folder || '')
  if (!target || !fs.existsSync(target)) return { ok: false, message: '그 폴더가 없어요.' }
  await shell.openPath(target)
  return { ok: true, message: '폴더를 열었어요.' }
})

// ═══════════════════════════════════════════
// 사용량 screen: read the logs when the tab opens, nothing in the background
// ═══════════════════════════════════════════
const USAGE_CAPS_KEY = 'usageCaps'
/** Provider numbers younger than this are reused instead of asking the site again. */
const USAGE_KEY_FRESH_MS = 10 * 60 * 1000

/** What the last screen was built from, so a new cap redraws without reading the logs again. */
let lastUsageInput: { sources: import('../src/core/agent-monitor/usage-summary').UsageSource[]; keys: import('../src/core/agent-monitor/usage-summary').KeyUsage[] } | null = null

function readUsageCaps(): Record<string, number> {
  try {
    const row = getDatabase().prepare('SELECT value_json FROM app_settings WHERE key = ?').get(USAGE_CAPS_KEY) as { value_json?: string } | undefined
    const parsed = row?.value_json ? JSON.parse(row.value_json) : {}
    const caps: Record<string, number> = {}
    if (parsed && typeof parsed === 'object') {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        const amount = Number(value)
        if (Number.isFinite(amount) && amount > 0) caps[id] = amount
      }
    }
    return caps
  } catch {
    return {}
  }
}

function writeUsageCaps(caps: Record<string, number>): void {
  getDatabase().prepare(`
    INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(USAGE_CAPS_KEY, JSON.stringify(caps), Date.now())
}

/** Keys whose spending this screen can show or link to, with a provider number when it is fresh. */
async function usageKeys(): Promise<import('../src/core/agent-monitor/usage-summary').KeyUsage[]> {
  const { listAgentServices, getCachedUsage, fetchAllUsage } = await import('../src/core/agent-monitor/agent-monitor-store')
  const services = (listAgentServices().data ?? []).filter((service) => service.enabled && ['openai', 'openrouter', 'claude_code'].includes(service.type))
  if (!services.length) return []
  let snapshots = getCachedUsage().data ?? []
  const needsFetch = services.some((service) => service.type === 'openrouter' && !snapshots.some((snap) => snap.serviceId === service.id && Date.now() - snap.fetchedAt < USAGE_KEY_FRESH_MS))
  if (needsFetch) {
    const fetched = await fetchAllUsage()
    if (fetched.ok && fetched.data) snapshots = fetched.data
  }
  return services.map((service) => ({
    serviceId: service.id,
    name: service.name,
    type: service.type,
    snapshot: snapshots.find((snap) => snap.serviceId === service.id) ?? null,
  }))
}

ipcMain.handle('usage:screen', async () => {
  const { readLocalUsageAsync } = await import('../src/core/agent-monitor/local-logs')
  const { buildUsageScreen } = await import('../src/core/agent-monitor/usage-summary')
  const { listPlaces } = await import('../src/core/skill-board/places')
  const { usageAt } = await import('../src/core/skill-board/board-service')
  type Source = import('../src/core/agent-monitor/usage-summary').UsageSource
  const tell = (payload: { done: number; total: number; place: string }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('usage:progress', payload)
    }
  }
  const local: Source = { place: '이 컴퓨터', ok: true, problem: '', entries: [] }
  // Other computers are asked at the same time as this one is read, so the wait is the longer of the two.
  const others = (await listPlaces(os.homedir())).filter((place) => place.kind !== 'local')
  const remotePromise = Promise.all(others.map(async (place): Promise<Source> => {
    const name = place.name.replace(/ \(SSH\)$/, '')
    tell({ done: 0, total: 0, place: name })
    const result = await usageAt(place.id)
    return { place: name, ok: result.ok, problem: result.ok ? '' : result.message, entries: result.entries }
  }))
  try {
    local.entries = await readLocalUsageAsync(os.homedir(), new Date(), (done, total) => tell({ done, total, place: '이 컴퓨터' }))
  } catch {
    local.ok = false
    local.problem = '이 컴퓨터의 기록을 읽지 못했어요.'
  }
  const remote = await remotePromise
  const keys = await usageKeys()
  lastUsageInput = { sources: [local, ...remote], keys }
  const screen = buildUsageScreen({ sources: lastUsageInput.sources, keys, caps: readUsageCaps() })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('usage:alerts', { count: screen.alerts, over: screen.over })
  }
  return screen
})

ipcMain.handle('usage:setCap', async (_event, cardId: string, amount: number) => {
  const { buildUsageScreen } = await import('../src/core/agent-monitor/usage-summary')
  const caps = readUsageCaps()
  const id = String(cardId || '')
  const value = Number(amount)
  if (!id) return { ok: false, message: '어느 카드인지 몰라요.', screen: null }
  if (Number.isFinite(value) && value > 0) caps[id] = Math.round(value * 100) / 100
  else delete caps[id]
  writeUsageCaps(caps)
  if (!lastUsageInput) return { ok: true, message: caps[id] ? '이 금액을 넘으면 알려 드릴게요.' : '정해 둔 금액을 지웠어요.', screen: null }
  const screen = buildUsageScreen({ sources: lastUsageInput.sources, keys: lastUsageInput.keys, caps })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('usage:alerts', { count: screen.alerts, over: screen.over })
  }
  return { ok: true, message: caps[id] ? '이 금액을 넘으면 알려 드릴게요.' : '정해 둔 금액을 지웠어요.', screen }
})

ipcMain.handle('usage:openLink', async (_event, url: string) => {
  const allowed = ['https://platform.openai.com/', 'https://console.anthropic.com/', 'https://openrouter.ai/']
  const target = String(url || '')
  if (!allowed.some((prefix) => target.startsWith(prefix))) return { ok: false, message: '열 수 없는 주소예요.' }
  await shell.openExternal(target)
  return { ok: true, message: '브라우저에서 열었어요.' }
})

ipcMain.handle('skillBoard:places', async () => {
  const { places } = await import('../src/core/skill-board/board-service')
  return places()
})

ipcMain.handle('skillBoard:get', async (_event, placeId: string) => {
  const { boardFor } = await import('../src/core/skill-board/board-service')
  return boardFor(String(placeId || 'local'))
})

ipcMain.handle('skillBoard:link', async (_event, placeId: string, agentId: string, skillName: string) => {
  const { linkAt } = await import('../src/core/skill-board/board-service')
  return linkAt(String(placeId || 'local'), String(agentId), String(skillName))
})

ipcMain.handle('skillBoard:unlink', async (_event, placeId: string, agentId: string, skillName: string) => {
  const { unlinkAt } = await import('../src/core/skill-board/board-service')
  return unlinkAt(String(placeId || 'local'), String(agentId), String(skillName))
})

ipcMain.handle('skillBoard:ack', async (_event, placeId: string, skillName: string) => {
  const { ackAt } = await import('../src/core/skill-board/board-service')
  return ackAt(String(placeId || 'local'), String(skillName))
})

ipcMain.handle('skillBoard:create', async (_event, placeId: string, name: string, summary: string, steps: string[], agentIds: string[]) => {
  const { createAt } = await import('../src/core/skill-board/board-service')
  return createAt(String(placeId || 'local'), String(name), String(summary), Array.isArray(steps) ? steps.map(String) : [], Array.isArray(agentIds) ? agentIds.map(String) : [])
})

ipcMain.handle('skillBoard:read', async (_event, placeId: string, name: string) => {
  const { readAt } = await import('../src/core/skill-board/board-service')
  return readAt(String(placeId || 'local'), String(name))
})

ipcMain.handle('skillBoard:save', async (_event, placeId: string, name: string, text: string) => {
  const { saveAt } = await import('../src/core/skill-board/board-service')
  return saveAt(String(placeId || 'local'), String(name), String(text))
})

ipcMain.handle('skillBoard:send', async (_event, fromId: string, toId: string, name: string, overwrite: boolean, agentIds?: string[]) => {
  const { sendSkill } = await import('../src/core/skill-board/board-service')
  return sendSkill(String(fromId), String(toId), String(name), Boolean(overwrite), Array.isArray(agentIds) ? agentIds.map(String) : undefined)
})

ipcMain.handle('skillBoard:history', async (_event, placeId: string, name: string) => {
  const { historyAt } = await import('../src/core/skill-board/board-service')
  return historyAt(String(placeId || 'local'), String(name))
})

ipcMain.handle('skillBoard:restore', async (_event, placeId: string, name: string, versionId: string) => {
  const { restoreAt } = await import('../src/core/skill-board/board-service')
  return restoreAt(String(placeId || 'local'), String(name), String(versionId))
})

ipcMain.handle('skillBoard:trash', async (_event, placeId: string, name: string) => {
  const { trashAt } = await import('../src/core/skill-board/board-service')
  return trashAt(String(placeId || 'local'), String(name))
})

ipcMain.handle('skillBoard:trashList', async (_event, placeId: string) => {
  const { trashListAt } = await import('../src/core/skill-board/board-service')
  return trashListAt(String(placeId || 'local'))
})

ipcMain.handle('skillBoard:untrash', async (_event, placeId: string, id: string) => {
  const { untrashAt } = await import('../src/core/skill-board/board-service')
  return untrashAt(String(placeId || 'local'), String(id))
})

ipcMain.handle('skillBoard:translate', async (_event, placeId: string, name: string, text: string) => {
  const { translateSkillMarkdown } = await import('../src/core/skill-board/translate')
  const { readSavedTranslation, writeSavedTranslation } = await import('../src/core/skill-board/translation-store')
  const { fetchTranslation } = await import('../src/core/skill-board/board-service')
  const os = await import('os')
  const slot = { home: os.homedir(), placeId: String(placeId || 'local'), name: String(name || '') }
  const source = String(text ?? '')
  if (slot.name && slot.placeId !== 'local' && !readSavedTranslation(slot.home, slot.placeId, slot.name, source)) {
    // That computer may already hold a Korean copy, which saves a minute of translating here.
    const borrowed = await fetchTranslation(slot.placeId, slot.name, source)
    if (borrowed) {
      writeSavedTranslation(slot.home, slot.placeId, slot.name, source, borrowed)
      return { ok: true, message: '그 컴퓨터에 있던 번역본이에요.', text: borrowed }
    }
  }
  return translateSkillMarkdown(source, slot)
})

ipcMain.handle('skillBoard:sendTranslation', async (_event, placeId: string, name: string, toIds: unknown) => {
  const { sendTranslation } = await import('../src/core/skill-board/board-service')
  return sendTranslation(String(placeId || 'local'), String(name || ''), Array.isArray(toIds) ? toIds.map(String) : [])
})

ipcMain.handle('skillBoard:retranslateLine', async (_event, placeId: string, name: string, text: string, korean: string, target: unknown) => {
  const { retranslateSkillLine } = await import('../src/core/skill-board/translate')
  const os = await import('os')
  const which = target === 'description' ? 'description' : Number(target)
  if (which !== 'description' && !Number.isInteger(which)) {
    return { ok: false, message: '이 줄을 찾지 못했어요.', text: String(korean ?? '') }
  }
  return retranslateSkillLine(String(text ?? ''), String(korean ?? ''), which, {
    home: os.homedir(),
    placeId: String(placeId || 'local'),
    name: String(name || ''),
  })
})

ipcMain.handle('skillBoard:compare', async (_event, placeId: string) => {
  const { compareAll } = await import('../src/core/skill-board/board-service')
  return compareAll(String(placeId || 'local'))
})

type WorkUndo = { action: 'dismiss' | 'finish'; task: import('../src/core/founder-work/parse-gate').OpenTask; from: string; to: string }
const workUndo = new Map<string, WorkUndo>()

async function workRoot(): Promise<string> {
  const { defaultReportRoot } = await import('../src/core/founder-work/read-report')
  return defaultReportRoot(process.platform)
}

/** Find the open task the window is talking about, re-read from disk so the file name is trusted. */
async function openTaskNamed(root: string, kind: string, fileName: string) {
  const { readReport } = await import('../src/core/founder-work/read-report')
  return readReport(root).open.find((task) => task.kind === kind && task.fileName === fileName) ?? null
}

function pushWork(work: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('founderWork:changed', work)
  }
}

ipcMain.handle('founderWork:list', async () => {
  const { readReport } = await import('../src/core/founder-work/read-report')
  return readReport(await workRoot())
})

ipcMain.handle('founderWork:dismiss', async (_event, kind: string, fileName: string) => {
  const { readReport } = await import('../src/core/founder-work/read-report')
  const { dismissOpenFile } = await import('../src/core/founder-work/dismiss')
  const root = await workRoot()
  const task = await openTaskNamed(root, String(kind), String(fileName ?? ''))
  const moved = task ? dismissOpenFile(root, task) : { ok: false, message: '이미 목록에 없어요.', from: '', to: '' }
  const undoId = moved.ok && task ? crypto.randomBytes(4).toString('hex') : ''
  if (undoId && task) workUndo.set(undoId, { action: 'dismiss', task, from: moved.from, to: moved.to })
  const work = readReport(root)
  pushWork(work)
  return { ...moved, undoId, work }
})

ipcMain.handle('founderWork:finish', async (_event, kind: string, fileName: string, note: string) => {
  const { readReport } = await import('../src/core/founder-work/read-report')
  const { finishOpenFile } = await import('../src/core/founder-work/dismiss')
  const root = await workRoot()
  const task = await openTaskNamed(root, String(kind), String(fileName ?? ''))
  const moved = task ? finishOpenFile(root, task, String(note ?? '')) : { ok: false, message: '이미 목록에 없어요.', from: '', to: '' }
  const undoId = moved.ok && task ? crypto.randomBytes(4).toString('hex') : ''
  if (undoId && task) workUndo.set(undoId, { action: 'finish', task, from: moved.from, to: moved.to })
  const work = readReport(root)
  pushWork(work)
  return { ...moved, undoId, work }
})

ipcMain.handle('founderWork:undo', async (_event, undoId: string) => {
  const { readReport } = await import('../src/core/founder-work/read-report')
  const { restoreOpenFile, unfinishOpenFile } = await import('../src/core/founder-work/dismiss')
  const root = await workRoot()
  const saved = workUndo.get(String(undoId ?? ''))
  let restored = { ok: false, message: '되돌릴 일이 없어요.', from: '', to: '' }
  if (saved) {
    restored = saved.action === 'dismiss'
      ? restoreOpenFile(root, saved.task, saved.from, saved.to)
      : unfinishOpenFile(root, saved.task, saved.from, saved.to)
  }
  if (restored.ok) workUndo.delete(String(undoId ?? ''))
  const work = readReport(root)
  pushWork(work)
  return { ...restored, work }
})

ipcMain.handle('founderWork:copy', (_event, text: string) => {
  clipboard.writeText(String(text ?? ''))
  return { ok: true }
})

/** Watch the Founder's to-do folders and push the list to the window whenever a file changes. */
function startWorkWatch(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastRoot = ''
  const publish = async () => {
    try {
      const { readReport } = await import('../src/core/founder-work/read-report')
      pushWork(readReport(await workRoot()))
    } catch {
      // The folder may be on a disk that is not mounted yet. The next tick tries again.
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void publish() }, 900)
  }
  const attach = async () => {
    const root = await workRoot()
    if (!root || root === lastRoot) return
    lastRoot = root
    const now = path.join(root, '00_NOW')
    try {
      fs.watch(now, { recursive: true }, schedule)
    } catch {
      // No native watcher here; the minute poll below still refreshes the list.
    }
  }
  setTimeout(() => { void attach(); void publish() }, 3_000)
  setInterval(() => { void attach(); void publish() }, 60_000)
}

ipcMain.handle('skillBoard:projects', async (_event, placeId: string) => {
  const { projectsAt } = await import('../src/core/skill-board/board-service')
  return projectsAt(String(placeId || 'local'))
})

ipcMain.handle('skillBoard:drift', async () => {
  const { countDrift } = await import('../src/core/skill-board/board-service')
  try {
    const count = await countDrift('local')
    return { count }
  } catch {
    return { count: 0 }
  }
})

ipcMain.handle('skillBoard:alignAll', async () => {
  const { alignAll } = await import('../src/core/skill-board/board-service')
  const result = await alignAll('local')
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('skillBoard:drift', { count: result.left })
  }
  return result
})

ipcMain.handle('skillBoard:guide', async (_event, placeId: string, agentId: string, on: boolean) => {
  const { guideAt } = await import('../src/core/skill-board/board-service')
  return guideAt(String(placeId || 'local'), String(agentId), Boolean(on))
})

ipcMain.handle('skillBoard:holders', async (_event, placeId: string, name: string) => {
  const { skillHolders } = await import('../src/core/skill-board/board-service')
  return skillHolders(String(placeId || 'local'), String(name))
})

ipcMain.handle('skillBoard:reflect', async (_event, placeId: string, name: string, toIds: string[]) => {
  const { reflectSkill } = await import('../src/core/skill-board/board-service')
  return reflectSkill(String(placeId || 'local'), String(name), Array.isArray(toIds) ? toIds.map(String) : [])
})

ipcMain.handle('skillBoard:saveCopy', async (_event, placeId: string, names: unknown) => {
  const { saveChosenSkills } = await import('../src/core/skill-board/board-service')
  return saveChosenSkills(String(placeId || 'local'), Array.isArray(names) ? names.map(String) : [], app.getPath('desktop'))
})

ipcMain.handle('skillBoard:reviewPack', async (_event, placeId: string, names: unknown) => {
  const { saveReviewPack } = await import('../src/core/skill-board/board-service')
  return saveReviewPack(String(placeId || 'local'), Array.isArray(names) ? names.map(String) : [], app.getPath('desktop'))
})

// ═══════════════════════════════════════════
// API keys (locked with the OS key store, never sent to the screen)
// ═══════════════════════════════════════════
const secretLock = {
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  lock: (plain: string) => safeStorage.encryptString(plain).toString('base64'),
  unlock: (locked: string) => safeStorage.decryptString(Buffer.from(locked, 'base64')),
}

/** Deleted keys wait here so 되돌리기 can put them back. Gone when the app closes. */
const deletedKeys = new Map<string, import('../src/core/api-keys/api-key-store').DeletedKey>()

/** The last .env write, so 되돌리기 can put that one file back. */
let envUndo: { keyId: string; file: string; backup: string; oldKey: string; project: string; platform: string; label: string; note: string } | null = null

const SCAN_ROOTS_KEY = 'apiScanRoots'

function readScanRoots(): string[] {
  try {
    const row = getDatabase().prepare('SELECT value_json FROM app_settings WHERE key = ?').get(SCAN_ROOTS_KEY) as { value_json?: string } | undefined
    const parsed = row?.value_json ? JSON.parse(row.value_json) : []
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

function writeScanRoots(roots: string[]): void {
  getDatabase().prepare(`
    INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(SCAN_ROOTS_KEY, JSON.stringify(roots), Date.now())
}

/** Folders the scan looks at: the ones the Founder added, project folders, and common project homes. */
async function allScanRoots(): Promise<string[]> {
  const { defaultScanRoots } = await import('../src/core/api-keys/env-scan')
  const db = getDatabase()
  const connected = (db.prepare("SELECT path FROM project_connections WHERE kind = 'folder'").all() as Array<{ path: string }>).map((row) => row.path)
  const roots = [...readScanRoots(), ...connected, ...defaultScanRoots(os.homedir())]
  return [...new Set(roots.map((root) => path.resolve(root)))].filter((root) => fs.existsSync(root))
}

/**
 * Keep one usage service per key whose platform DIOS can look up.
 * The service holds the key too, because the usage lookup needs it as it is.
 */
async function syncUsageService(keyId: string): Promise<void> {
  const { keyForService, setKeyService } = await import('../src/core/api-keys/api-key-store')
  const { USAGE_TYPES } = await import('../src/core/api-keys/api-key-text')
  const { createAgentService, updateAgentService } = await import('../src/core/agent-monitor/agent-monitor-store')
  const db = getDatabase()
  const found = keyForService(db, secretLock, keyId)
  if (!found || !found.key) return
  const type = USAGE_TYPES[found.platform]
  if (!type) return
  const name = `${found.project} · ${found.platform}${found.label ? ` · ${found.label}` : ''}`
  if (found.serviceId) {
    const updated = updateAgentService(found.serviceId, { name, type: type as never, apiKey: found.key })
    if (updated.ok) return
  }
  const created = createAgentService({ name, type: type as never, apiKey: found.key, monthlyCap: 0 })
  if (created.ok && created.data) setKeyService(db, keyId, created.data.id)
}

async function keyListing() {
  const { listApiKeys, knownProjects } = await import('../src/core/api-keys/api-key-store')
  const { getCachedUsage } = await import('../src/core/agent-monitor/agent-monitor-store')
  const db = getDatabase()
  const projectRows = db.prepare('SELECT name FROM projects ORDER BY name').all() as Array<{ name: string }>
  const usage = getCachedUsage()
  return {
    cards: listApiKeys(db),
    projects: knownProjects(db, projectRows.map((row) => row.name)),
    locked: secretLock.available(),
    usage: usage.ok ? usage.data ?? [] : [],
    scanRoots: await allScanRoots(),
  }
}

ipcMain.handle('apiKeys:list', async () => keyListing())

ipcMain.handle('apiKeys:add', async (_event, input: unknown) => {
  const { addApiKey } = await import('../src/core/api-keys/api-key-store')
  const result = addApiKey(getDatabase(), secretLock, (input ?? {}) as Record<string, string>)
  if (result.ok) {
    recordActivity('apiKey', 'API 키 등록', '')
    await syncUsageService(result.id)
    result.cards = (await keyListing()).cards
  }
  return result
})

ipcMain.handle('apiKeys:update', async (_event, id: string, input: unknown) => {
  const { updateApiKey, keyForService, listApiKeys, revealApiKey } = await import('../src/core/api-keys/api-key-store')
  const { writeEnvKey } = await import('../src/core/api-keys/env-write')
  const db = getDatabase()
  const keyId = String(id || '')
  const priorCard = listApiKeys(db).find((card) => card.id === keyId)
  const prior = keyForService(db, secretLock, keyId)
  const result: Awaited<ReturnType<typeof updateApiKey>> & { undoEnv?: boolean } = updateApiKey(db, secretLock, keyId, (input ?? {}) as Record<string, string>)
  if (result.ok) {
    recordActivity('apiKey', 'API 키 수정', '')
    await syncUsageService(keyId)
    if (result.keyChanged && priorCard?.source && prior?.key && prior.label) {
      const after = revealApiKey(db, secretLock, keyId)
      if (after.ok && after.key !== prior.key) {
        const written = writeEnvKey(priorCard.source, prior.label, prior.key, after.key)
        if (written.changed) {
          envUndo = { keyId, file: priorCard.source, backup: written.backup, oldKey: prior.key, project: prior.project, platform: prior.platform, label: prior.label, note: priorCard.note }
          result.message = `${result.message} ${written.message}`
          result.undoEnv = true
        } else if (!written.ok) {
          result.message = `${result.message} ${written.message}`
        }
      }
    }
    result.cards = (await keyListing()).cards
  }
  return result
})

ipcMain.handle('apiKeys:delete', async (_event, id: string) => {
  const { deleteApiKey } = await import('../src/core/api-keys/api-key-store')
  const { deleteAgentService } = await import('../src/core/agent-monitor/agent-monitor-store')
  const result = deleteApiKey(getDatabase(), String(id || ''))
  if (result.ok && result.deleted) {
    deletedKeys.set(result.deleted.id, result.deleted)
    if (result.deleted.serviceId) deleteAgentService(result.deleted.serviceId)
    recordActivity('apiKey', 'API 키 삭제', '')
  }
  return { ok: result.ok, message: result.message, cards: result.cards, undoId: result.deleted?.id ?? '' }
})

ipcMain.handle('apiKeys:undoEnv', async () => {
  const { updateApiKey } = await import('../src/core/api-keys/api-key-store')
  const { restoreEnvBackup } = await import('../src/core/api-keys/env-write')
  const saved = envUndo
  if (!saved) return { ok: false, message: '되돌릴 파일 수정이 없어요.', cards: (await keyListing()).cards }
  if (!restoreEnvBackup(saved.file, saved.backup)) {
    return { ok: false, message: '설정 파일을 되돌리지 못했어요.', cards: (await keyListing()).cards }
  }
  const result = updateApiKey(getDatabase(), secretLock, saved.keyId, {
    project: saved.project, platform: saved.platform, label: saved.label, key: saved.oldKey, note: saved.note,
  })
  if (result.ok) {
    envUndo = null
    await syncUsageService(saved.keyId)
    result.message = '프로젝트 설정과 키를 되돌렸어요.'
    result.cards = (await keyListing()).cards
  }
  return result
})

ipcMain.handle('apiKeys:check', async () => {
  const { listApiKeys, revealApiKey, setKeyHealth } = await import('../src/core/api-keys/api-key-store')
  const { canProbe, probeKey, checkSummary } = await import('../src/core/api-keys/key-health')
  const db = getDatabase()
  const cards = listApiKeys(db)
  const counts = { ok: 0, dead: 0, limited: 0, unknown: 0 }
  const targets = cards.filter((card) => canProbe(card.platform))
  let cursor = 0
  async function worker() {
    while (cursor < targets.length) {
      const card = targets[cursor]
      cursor += 1
      const opened = revealApiKey(db, secretLock, card.id)
      const state = opened.ok ? await probeKey(card.platform, opened.key) : 'unknown'
      setKeyHealth(db, card.id, state, Date.now())
      counts[state] += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()))
  if (counts.dead || counts.ok) recordActivity('apiKey', 'API 키 상태 확인', `${counts.ok}개 정상, ${counts.dead}개 안 됨`)
  return { ok: true, message: checkSummary(counts), listing: await keyListing() }
})

ipcMain.handle('apiKeys:undoDelete', async (_event, id: string) => {
  const { restoreApiKey } = await import('../src/core/api-keys/api-key-store')
  const deleted = deletedKeys.get(String(id || ''))
  if (!deleted) return { ok: false, message: '되돌릴 키가 없어요.', cards: (await keyListing()).cards }
  const result = restoreApiKey(getDatabase(), { ...deleted, serviceId: '' })
  if (result.ok) {
    deletedKeys.delete(deleted.id)
    await syncUsageService(deleted.id)
    result.cards = (await keyListing()).cards
  }
  return result
})

ipcMain.handle('apiKeys:peekAll', async () => {
  const { revealAllApiKeys } = await import('../src/core/api-keys/api-key-store')
  return revealAllApiKeys(getDatabase(), secretLock)
})

ipcMain.handle('apiKeys:scan', async () => {
  const { scanEnvRoots, scanMessage } = await import('../src/core/api-keys/env-scan')
  const { registerFindings } = await import('../src/core/api-keys/api-key-store')
  const roots = await allScanRoots()
  const scanned = scanEnvRoots(roots)
  const registered = registerFindings(getDatabase(), secretLock, scanned.findings)
  for (const id of registered.added) await syncUsageService(id)
  if (registered.added.length) recordActivity('apiKey', '프로젝트 폴더에서 API 키 찾아 등록', `${registered.added.length}개`)
  return {
    ok: true,
    message: scanMessage(scanned.folders, scanned.files, registered.added.length, registered.kept, scanned.findings.length),
    added: registered.added.length,
    listing: await keyListing(),
  }
})

ipcMain.handle('apiKeys:addScanRoot', async () => {
  const picked = await dialog.showOpenDialog({ title: '훑을 프로젝트 폴더 고르기', properties: ['openDirectory'] })
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, message: '', listing: await keyListing() }
  const roots = readScanRoots()
  const next = path.resolve(picked.filePaths[0])
  if (!roots.includes(next)) writeScanRoots([...roots, next])
  return { ok: true, message: '폴더를 추가했어요. 훑기를 누르면 그 안의 키도 찾아요.', listing: await keyListing() }
})

ipcMain.handle('apiKeys:removeScanRoot', async (_event, root: string) => {
  writeScanRoots(readScanRoots().filter((item) => item !== String(root)))
  return { ok: true, message: '그 폴더는 더 훑지 않아요.', listing: await keyListing() }
})

ipcMain.handle('apiKeys:refreshUsage', async () => {
  const { fetchAllUsage } = await import('../src/core/agent-monitor/agent-monitor-store')
  const { listApiKeys, setKeyHealth } = await import('../src/core/api-keys/api-key-store')
  const { healthFromUsageError } = await import('../src/core/api-keys/key-health')
  const result = await fetchAllUsage()
  if (result.ok && result.data) {
    const db = getDatabase()
    const cards = listApiKeys(db)
    for (const snapshot of result.data) {
      const state = healthFromUsageError(snapshot.error, snapshot.type)
      if (!state) continue
      const card = cards.find((item) => item.serviceId === snapshot.serviceId)
      if (card) setKeyHealth(db, card.id, state, Date.now())
    }
  }
  return { ok: result.ok, message: result.ok ? '사용량을 새로 받았어요.' : '사용량을 못 받았어요. 인터넷을 확인해 주세요.', listing: await keyListing() }
})

ipcMain.handle('apiKeys:copy', async (_event, id: string) => {
  const { revealApiKey } = await import('../src/core/api-keys/api-key-store')
  const result = revealApiKey(getDatabase(), secretLock, String(id || ''))
  if (!result.ok) return { ok: false, message: result.message }
  clipboard.writeText(result.key)
  return { ok: true, message: '키를 복사했어요. 붙여 넣을 곳에 바로 넣으면 돼요.' }
})

ipcMain.handle('apiKeys:peek', async (_event, id: string) => {
  const { revealApiKey } = await import('../src/core/api-keys/api-key-store')
  const result = revealApiKey(getDatabase(), secretLock, String(id || ''))
  return result.ok ? { ok: true, message: '', key: result.key } : { ok: false, message: result.message, key: '' }
})

ipcMain.handle('skillBoard:openFolder', async (_event, folder: string) => {
  const desktop = path.resolve(app.getPath('desktop'))
  const resolved = path.resolve(String(folder || ''))
  const allowed = [path.resolve(desktop, COPY_FOLDER), path.resolve(desktop, REVIEW_FOLDER)]
  if (!allowed.includes(resolved) || !fs.existsSync(resolved)) return { ok: false, message: '그 폴더를 열지 못했어요.' }
  const error = await shell.openPath(resolved)
  return error ? { ok: false, message: '그 폴더를 열지 못했어요.' } : { ok: true, message: '폴더를 열었어요.' }
})

// ═══════════════════════════════════════════
// Operations center
// ═══════════════════════════════════════════
ipcMain.handle('operations:settings:get', async () => {
  const { getAppSettings } = await import('../src/core/operations/operations-store')
  return getAppSettings()
})

ipcMain.handle('operations:backup', async () => {
  try {
    if (!databasePath || !fs.existsSync(databasePath)) return { success: false, error: 'DIOS 데이터베이스를 찾을 수 없습니다.' }
    const backupPath = createDatabaseBackup()
    return { success: true, path: backupPath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('operations:settings:save', async (_event, settings: any) => {
  const { saveAppSettings } = await import('../src/core/operations/operations-store')
  const saved = saveAppSettings(settings)
  pruneBackups()
  return saved
})

ipcMain.handle('operations:connections:list', async () => {
  const { listConnections } = await import('../src/core/operations/operations-store')
  return listConnections()
})

ipcMain.handle('operations:connections:create', async (_event, input: any) => {
  const { createConnection } = await import('../src/core/operations/operations-store')
  return createConnection(input)
})

ipcMain.handle('operations:connections:update', async (_event, id: string, input: any) => {
  const { updateConnection } = await import('../src/core/operations/operations-store')
  return updateConnection(id, input)
})

ipcMain.handle('operations:connections:delete', async (_event, id: string) => {
  const { deleteConnection } = await import('../src/core/operations/operations-store')
  return deleteConnection(id)
})

ipcMain.handle('operations:connections:check', async (_event, id: string) => {
  const { checkConnection } = await import('../src/core/operations/operations-store')
  return checkConnection(id)
})

ipcMain.handle('operations:connections:recordUsage', async (_event, id: string, input: any) => {
  const { recordConnectionUsage } = await import('../src/core/operations/operations-store')
  return recordConnectionUsage(id, input)
})

ipcMain.handle('operations:connections:fetchUsage', async (_event, id: string) => {
  const { fetchConnectionUsage } = await import('../src/core/operations/operations-store')
  return fetchConnectionUsage(id)
})

ipcMain.handle('operations:roadmap:list', async () => {
  const { listRoadmap } = await import('../src/core/operations/operations-store')
  return listRoadmap()
})

ipcMain.handle('operations:roadmap:updateTask', async (_event, id: string, status: 'todo' | 'in_progress' | 'done') => {
  const { updateRoadmapTask } = await import('../src/core/operations/operations-store')
  return updateRoadmapTask(id, status)
})

ipcMain.handle('operations:backups:list', async () => {
  const directory = backupDirectory()
  return fs.readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith('.db'))
    .map((name) => {
      const filePath = path.join(directory, name)
      const stat = fs.statSync(filePath)
      return { name, path: filePath, size: stat.size, createdAt: stat.birthtimeMs, updatedAt: stat.mtimeMs }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

ipcMain.handle('operations:backups:restore', async (_event, name: string) => {
  let safetyBackup = ''
  try {
    const directory = backupDirectory()
    const backupPath = path.resolve(directory, path.basename(name))
    if (path.dirname(backupPath) !== path.resolve(directory) || !fs.existsSync(backupPath)) {
      return { success: false, error: '유효한 백업 파일을 찾을 수 없습니다.' }
    }
    safetyBackup = createDatabaseBackup()
    getDatabase().close()
    try {
      fs.copyFileSync(backupPath, databasePath)
      initDatabase(databasePath)
    } catch (restoreError) {
      try { getDatabase().close() } catch { /* the failed database may already be closed */ }
      fs.copyFileSync(safetyBackup, databasePath)
      initDatabase(databasePath)
      return { success: false, error: `백업 복구에 실패하여 복구 전 상태로 되돌렸습니다: ${String(restoreError)}`, safetyBackup }
    }
    recordActivity('restore', 'DIOS 백업 복구 완료', `${name} 복구 전 안전 백업: ${path.basename(safetyBackup)}`)
    return { success: true, safetyBackup }
  } catch (error) {
    return { success: false, error: String(error), safetyBackup: safetyBackup || undefined }
  }
})

ipcMain.handle('operations:systemStatus', async () => {
  const memoryTotal = os.totalmem()
  const memoryFree = os.freemem()
  return {
    platform: `${os.platform()} ${os.release()}`,
    hostname: os.hostname(),
    cpuCount: os.cpus().length,
    memoryTotal,
    memoryFree,
    memoryUsed: memoryTotal - memoryFree,
    processMemory: process.memoryUsage(),
    uptime: os.uptime(),
    appUptime: process.uptime(),
    pid: process.pid,
    databasePath,
    databaseExists: Boolean(databasePath && fs.existsSync(databasePath)),
    disk: (() => {
      try {
        const stats = (fs as any).statfsSync(databasePath || process.cwd())
        return { total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize }
      } catch {
        return null
      }
    })(),
  }
})

async function runWorkspaceCommand(command: string, args: string[], cwd: string, timeout = 120000) {
  try {
    const result = await runQuiet(command, args, '', { cwd, timeoutMs: timeout })
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    if (result.code === 0) return { success: true, output }
    return { success: false, output, code: result.code }
  } catch (error: any) {
    return { success: false, output: `${error?.message || error}`.trim() }
  }
}

ipcMain.handle('operations:workspaceReport', async (_event, root: string) => {
  if (!root || !fs.existsSync(root)) return { success: false, error: '작업 폴더를 찾을 수 없습니다.' }
  const status = await runWorkspaceCommand('git', ['status', '--short'], root, 15000)
  const diff = await runWorkspaceCommand('git', ['diff', '--stat'], root, 15000)
  return { success: status.success || diff.success, root, status: status.output, diff: diff.output, checkedAt: Date.now() }
})

ipcMain.handle('operations:workspaceTests', async (_event, root: string) => {
  if (!root || !fs.existsSync(root)) return { success: false, error: '작업 폴더를 찾을 수 없습니다.' }
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = await runWorkspaceCommand(command, ['test'], root)
  recordActivity('test', result.success ? '테스트 통과' : '테스트 실패', root)
  return { ...result, root, checkedAt: Date.now() }
})

function seedMaintenance() {
  const db = getDatabase()
  const count = (db.prepare('SELECT COUNT(*) as count FROM maintenance_checks').get() as { count: number }).count
  if (count > 0) return
  const insert = db.prepare('INSERT INTO maintenance_checks (id, title, description, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)')
  const items = [
    ['최근 백업 생성', '최신 백업 파일이 있는지 확인합니다.'],
    ['연결 폴더 정상', '스캔 대상 폴더가 아직 존재하는지 확인합니다.'],
    ['최근 테스트 통과', '가장 최근 테스트 결과를 확인합니다.'],
    ['오류 로그 확인', '최근 실패 작업과 오류 메시지를 확인합니다.'],
    ['오래된 Task 정리', '끝난 Task와 보류 Task를 정리합니다.'],
    ['운영지침 최신 상태', '현재 Phase와 운영지침이 맞는지 확인합니다.'],
  ]
  const transaction = db.transaction(() => items.forEach(([title, description], index) => insert.run(crypto.randomUUID(), title, description, index, Date.now())))
  transaction()
}

ipcMain.handle('operations:maintenance:list', async () => {
  seedMaintenance()
  return getDatabase().prepare('SELECT id, title, description, done, checked_at as checkedAt, sort_order as sortOrder FROM maintenance_checks ORDER BY sort_order').all().map((item: any) => ({ ...item, done: Boolean(item.done) }))
})

ipcMain.handle('operations:maintenance:update', async (_event, id: string, done: boolean) => {
  getDatabase().prepare('UPDATE maintenance_checks SET done = ?, checked_at = ?, updated_at = ? WHERE id = ?').run(done ? 1 : 0, done ? Date.now() : null, Date.now(), id)
  recordActivity('maintenance', done ? '유지보수 항목 완료' : '유지보수 항목 재개', id)
  return getDatabase().prepare('SELECT id, title, description, done, checked_at as checkedAt, sort_order as sortOrder FROM maintenance_checks ORDER BY sort_order').all().map((item: any) => ({ ...item, done: Boolean(item.done) }))
})

ipcMain.handle('operations:activity:list', async () => {
  return getDatabase().prepare('SELECT id, type, title, description, created_at as createdAt FROM activity_events ORDER BY created_at DESC LIMIT 100').all()
})

ipcMain.handle('operations:taskRequests:save', async (_event, input: any) => {
  const id = crypto.randomUUID()
  getDatabase().prepare('INSERT INTO task_requests (id, title, goal, scope, reference_text, acceptance, forbidden, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.title, input.goal, input.scope || '', input.references || '', input.acceptance || '', input.forbidden || '', input.content, Date.now())
  recordActivity('task', 'Agent 작업 요청서 저장', input.title)
  return { id, ...input, createdAt: Date.now() }
})

ipcMain.handle('operations:taskRequests:list', async () => {
  return getDatabase().prepare('SELECT id, title, goal, scope, reference_text as referenceText, acceptance, forbidden, content, created_at as createdAt FROM task_requests ORDER BY created_at DESC').all()
})

// ═══════════════════════════════════════════
// Emergency Stop
// ═══════════════════════════════════════════
ipcMain.handle('emergency:stop', async () => {
  if (mainWindow) {
    mainWindow.webContents.send('dios:emergency-stop')
  }
  return { success: true }
})
