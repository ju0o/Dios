import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import { initDatabase, getDatabase } from './db/schema'

let mainWindow: BrowserWindow | null = null
let databasePath = ''
const execFileAsync = promisify(execFile)

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
  const dbPath = path.join(app.getPath('userData'), 'dios.db')
  databasePath = dbPath
  initDatabase(dbPath)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

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
    const result = await execFileAsync(command, args, { cwd, timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 4 })
    return { success: true, output: `${result.stdout || ''}${result.stderr || ''}`.trim() }
  } catch (error: any) {
    return { success: false, output: `${error?.stdout || ''}${error?.stderr || error?.message || error}`.trim(), code: error?.code }
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
