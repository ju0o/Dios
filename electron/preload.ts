import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ═══════════════════════════════════════════
  // Projects
  // ═══════════════════════════════════════════
  getProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (project: any) => ipcRenderer.invoke('project:create', project),
  updateProject: (project: any) => ipcRenderer.invoke('project:update', project),
  deleteProject: (projectId: string) => ipcRenderer.invoke('project:delete', projectId),
  getProjectRunbook: (projectId: string) => ipcRenderer.invoke('project:runbook:get', projectId),
  saveProjectRunbook: (projectId: string, content: string) => ipcRenderer.invoke('project:runbook:save', projectId, content),
  listProjectConnections: (projectId: string) => ipcRenderer.invoke('project:connections:list', projectId),
  saveProjectConnection: (input: any) => ipcRenderer.invoke('project:connections:save', input),
  deleteProjectConnection: (id: string) => ipcRenderer.invoke('project:connections:delete', id),
  exportProject: (projectId: string) => ipcRenderer.invoke('project:export', projectId),
  importProject: () => ipcRenderer.invoke('project:import'),
  
  // ═══════════════════════════════════════════
  // Documents
  // ═══════════════════════════════════════════
  getDocuments: (projectId: string) => ipcRenderer.invoke('document:list', projectId),
  saveDocument: (doc: any) => ipcRenderer.invoke('document:save', doc),
  updateDocument: (doc: any) => ipcRenderer.invoke('document:update', doc),
  deleteDocument: (documentId: string) => ipcRenderer.invoke('document:delete', documentId),
  
  // ═══════════════════════════════════════════
  // Files
  // ═══════════════════════════════════════════
  deleteFile: (filePath: string) => ipcRenderer.invoke('file:delete', filePath),
  
  // ═══════════════════════════════════════════
  // Scanner
  // ═══════════════════════════════════════════
  scanRoots: (roots: string[]) => ipcRenderer.invoke('scan:roots', roots),
  searchDocuments: (query: string, filters?: any) => ipcRenderer.invoke('search:documents', query, filters),
  
  // ═══════════════════════════════════════════
  // Graph
  // ═══════════════════════════════════════════
  getGraphData: () => ipcRenderer.invoke('graph:get'),
  
  // ═══════════════════════════════════════════
  // Experiments
  // ═══════════════════════════════════════════
  createExperiment: (input: any) => ipcRenderer.invoke('experiment:create', input),
  getExperiment: (id: string) => ipcRenderer.invoke('experiment:get', id),
  listExperiments: () => ipcRenderer.invoke('experiment:list'),
  transitionExperiment: (input: any) => ipcRenderer.invoke('experiment:transition', input),
  listExperimentTransitions: (experimentId: string) => ipcRenderer.invoke('experiment:transitions', experimentId),
  
  // ═══════════════════════════════════════════
  // Decision Ledger
  // ═══════════════════════════════════════════
  createDecision: (input: any) => ipcRenderer.invoke('decision:create', input),
  listDecisions: () => ipcRenderer.invoke('decision:list'),
  getDecision: (id: string) => ipcRenderer.invoke('decision:get', id),
  verifyDecisionChain: () => ipcRenderer.invoke('decision:verify'),
  
  // ═══════════════════════════════════════════
  // Human Gate
  // ═══════════════════════════════════════════
  createHumanGate: (input: any) => ipcRenderer.invoke('humanGate:create', input),
  listHumanGates: () => ipcRenderer.invoke('humanGate:list'),
  seedDefaultGates: () => ipcRenderer.invoke('humanGate:seed'),
  requestThresholdChange: (input: any) => ipcRenderer.invoke('humanGate:requestChange', input),
  approveThresholdChange: (input: any) => ipcRenderer.invoke('humanGate:approveChange', input),
  listPendingEvents: () => ipcRenderer.invoke('humanGate:pendingEvents'),
  setGateEnabled: (gateId: string, enabled: boolean, requestedBy: string) => 
    ipcRenderer.invoke('humanGate:setEnabled', gateId, enabled, requestedBy),
  
  // ═══════════════════════════════════════════
  // AI Resources
  // ═══════════════════════════════════════════
  listAIResources: () => ipcRenderer.invoke('aiResource:list'),
  getAIResource: (id: string) => ipcRenderer.invoke('aiResource:get', id),
  createAIResource: (input: any) => ipcRenderer.invoke('aiResource:create', input),
  updateAIResource: (id: string, input: any) => ipcRenderer.invoke('aiResource:update', id, input),
  recordAIUsage: (input: any) => ipcRenderer.invoke('aiResource:recordUsage', input),
  resetMonthlyUsage: (resourceId: string) => ipcRenderer.invoke('aiResource:resetMonthly', resourceId),
  getUsageHistory: (resourceId: string) => ipcRenderer.invoke('aiResource:usageHistory', resourceId),

  // ═══════════════════════════════════════════
  // Agent Monitor (구독 AI 서비스 사용량 추적)
  // ═══════════════════════════════════════════
  listAgentServices: () => ipcRenderer.invoke('agentMonitor:listServices'),
  createAgentService: (input: any) => ipcRenderer.invoke('agentMonitor:createService', input),
  updateAgentService: (id: string, input: any) => ipcRenderer.invoke('agentMonitor:updateService', id, input),
  deleteAgentService: (id: string) => ipcRenderer.invoke('agentMonitor:deleteService', id),
  fetchAllAgentUsage: () => ipcRenderer.invoke('agentMonitor:fetchAllUsage'),
  getCachedAgentUsage: () => ipcRenderer.invoke('agentMonitor:getCachedUsage'),
  countLocalFiles: () => ipcRenderer.invoke('agentMonitor:countFiles'),

  skillBoardPlaces: () => ipcRenderer.invoke('skillBoard:places'),
  skillBoardGet: (placeId: string) => ipcRenderer.invoke('skillBoard:get', placeId),
  skillBoardLink: (placeId: string, agentId: string, skillName: string) => ipcRenderer.invoke('skillBoard:link', placeId, agentId, skillName),
  skillBoardUnlink: (placeId: string, agentId: string, skillName: string) => ipcRenderer.invoke('skillBoard:unlink', placeId, agentId, skillName),
  skillBoardAck: (placeId: string, skillName: string) => ipcRenderer.invoke('skillBoard:ack', placeId, skillName),
  skillBoardCreate: (placeId: string, name: string, summary: string, steps: string[], agentIds: string[]) => ipcRenderer.invoke('skillBoard:create', placeId, name, summary, steps, agentIds),
  skillBoardRead: (placeId: string, name: string) => ipcRenderer.invoke('skillBoard:read', placeId, name),
  skillBoardSave: (placeId: string, name: string, text: string) => ipcRenderer.invoke('skillBoard:save', placeId, name, text),
  skillBoardSend: (fromId: string, toId: string, name: string, overwrite: boolean, agentIds?: string[]) => ipcRenderer.invoke('skillBoard:send', fromId, toId, name, overwrite, agentIds),
  skillBoardHistory: (placeId: string, name: string) => ipcRenderer.invoke('skillBoard:history', placeId, name),
  skillBoardRestore: (placeId: string, name: string, versionId: string) => ipcRenderer.invoke('skillBoard:restore', placeId, name, versionId),
  skillBoardTrash: (placeId: string, name: string) => ipcRenderer.invoke('skillBoard:trash', placeId, name),
  skillBoardTrashList: (placeId: string) => ipcRenderer.invoke('skillBoard:trashList', placeId),
  skillBoardUntrash: (placeId: string, id: string) => ipcRenderer.invoke('skillBoard:untrash', placeId, id),
  skillBoardCompare: (placeId: string) => ipcRenderer.invoke('skillBoard:compare', placeId),
  skillBoardTranslate: (placeId: string, name: string, text: string) => ipcRenderer.invoke('skillBoard:translate', placeId, name, text),
  skillBoardRetranslateLine: (placeId: string, name: string, text: string, korean: string, target: 'description' | number) => ipcRenderer.invoke('skillBoard:retranslateLine', placeId, name, text, korean, target),
  skillBoardGuide: (placeId: string, agentId: string, on: boolean) => ipcRenderer.invoke('skillBoard:guide', placeId, agentId, on),
  skillBoardHolders: (placeId: string, name: string) => ipcRenderer.invoke('skillBoard:holders', placeId, name),
  skillBoardReflect: (placeId: string, name: string, toIds: string[]) => ipcRenderer.invoke('skillBoard:reflect', placeId, name, toIds),
  skillBoardSaveCopy: (placeId: string, names: string[]) => ipcRenderer.invoke('skillBoard:saveCopy', placeId, names),
  skillBoardReviewPack: (placeId: string, names: string[]) => ipcRenderer.invoke('skillBoard:reviewPack', placeId, names),
  skillBoardOpenFolder: (folder: string) => ipcRenderer.invoke('skillBoard:openFolder', folder),
  skillBoardSendTranslation: (placeId: string, name: string, toIds: string[]) => ipcRenderer.invoke('skillBoard:sendTranslation', placeId, name, toIds),
  founderWorkList: () => ipcRenderer.invoke('founderWork:list'),
  founderWorkDismiss: (kind: 'aside' | 'founder', fileName: string) => ipcRenderer.invoke('founderWork:dismiss', kind, fileName),
  founderWorkFinish: (kind: 'aside' | 'founder', fileName: string, note: string) => ipcRenderer.invoke('founderWork:finish', kind, fileName, note),
  founderWorkUndo: (undoId: string) => ipcRenderer.invoke('founderWork:undo', undoId),
  founderWorkCopy: (text: string) => ipcRenderer.invoke('founderWork:copy', text),
  onFounderWork: (callback: (work: unknown) => void) => {
    const listener = (_event: unknown, work: unknown) => callback(work)
    ipcRenderer.on('founderWork:changed', listener)
    return () => ipcRenderer.removeListener('founderWork:changed', listener)
  },
  libraryList: () => ipcRenderer.invoke('library:list'),
  libraryPreview: (address: string) => ipcRenderer.invoke('library:preview', address),
  libraryAdd: (candidate: unknown, agentIds: string[] | null) => ipcRenderer.invoke('library:add', candidate, agentIds),
  libraryAddFolder: (agentIds: string[] | null) => ipcRenderer.invoke('library:addFolder', agentIds),
  libraryAttach: (name: string, agentIds: string[]) => ipcRenderer.invoke('library:attach', name, agentIds),
  libraryAdopt: (name: string, from: string, agentIds: string[] | null) => ipcRenderer.invoke('library:adopt', name, from, agentIds),
  libraryRemotes: () => ipcRenderer.invoke('library:remotes'),
  libraryTake: (placeId: string, name: string) => ipcRenderer.invoke('library:take', placeId, name),
  libraryGather: () => ipcRenderer.invoke('library:gather'),
  libraryBlurb: (name: string) => ipcRenderer.invoke('library:blurb', name),
  libraryBlurbState: () => ipcRenderer.invoke('library:blurbState'),
  libraryBlurbPause: () => ipcRenderer.invoke('library:blurbPause'),
  onLibraryBlurb: (callback: (progress: unknown) => void) => {
    const listener = (_event: unknown, progress: unknown) => callback(progress)
    ipcRenderer.on('library:blurb', listener)
    return () => ipcRenderer.removeListener('library:blurb', listener)
  },
  projectRelayList: () => ipcRenderer.invoke('project:relayList'),
  projectSkills: (projectName: string) => ipcRenderer.invoke('project:skills', projectName),
  projectSkillSet: (projectName: string, skillName: string, on: boolean) => ipcRenderer.invoke('project:skillSet', projectName, skillName, on),
  projectSkillPack: (projectName: string) => ipcRenderer.invoke('project:skillPack', projectName),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  onAppOpen: (callback: (view: string) => void) => {
    const listener = (_event: unknown, view: string) => callback(view)
    ipcRenderer.on('app:open', listener)
    return () => ipcRenderer.removeListener('app:open', listener)
  },
  libraryOpenFolder: (folder: string) => ipcRenderer.invoke('library:openFolder', folder),
  startLook: () => ipcRenderer.invoke('start:look'),
  usageToday: (projectLabel: string) => ipcRenderer.invoke('usage:today', projectLabel),
  usageWeek: (projectLabel: string) => ipcRenderer.invoke('usage:week', projectLabel),
  whatsNew: () => ipcRenderer.invoke('update:whatsNew'),
  usageScreen: () => ipcRenderer.invoke('usage:screen'),
  usageSetCap: (cardId: string, amount: number) => ipcRenderer.invoke('usage:setCap', cardId, amount),
  usageOpenLink: (url: string) => ipcRenderer.invoke('usage:openLink', url),
  onUsageAlerts: (callback: (payload: { count: number; over: number }) => void) => {
    const listener = (_event: unknown, payload: { count: number; over: number }) => callback(payload)
    ipcRenderer.on('usage:alerts', listener)
    return () => ipcRenderer.removeListener('usage:alerts', listener)
  },
  onUsageProgress: (callback: (payload: { done: number; total: number; place: string }) => void) => {
    const listener = (_event: unknown, payload: { done: number; total: number; place: string }) => callback(payload)
    ipcRenderer.on('usage:progress', listener)
    return () => ipcRenderer.removeListener('usage:progress', listener)
  },
  skillBoardProjects: (placeId: string) => ipcRenderer.invoke('skillBoard:projects', placeId),
  skillBoardDrift: () => ipcRenderer.invoke('skillBoard:drift'),
  skillBoardAlignAll: () => ipcRenderer.invoke('skillBoard:alignAll'),
  onSkillDrift: (callback: (payload: { count: number }) => void) => {
    const listener = (_event: unknown, payload: { count: number }) => callback(payload)
    ipcRenderer.on('skillBoard:drift', listener)
    return () => ipcRenderer.removeListener('skillBoard:drift', listener)
  },

  // ═══════════════════════════════════════════
  // API keys (the secret stays in the main process; the screen sees a masked copy)
  // ═══════════════════════════════════════════
  apiKeysList: () => ipcRenderer.invoke('apiKeys:list'),
  apiKeysAdd: (input: unknown) => ipcRenderer.invoke('apiKeys:add', input),
  apiKeysUpdate: (id: string, input: unknown) => ipcRenderer.invoke('apiKeys:update', id, input),
  apiKeysDelete: (id: string) => ipcRenderer.invoke('apiKeys:delete', id),
  apiKeysCopy: (id: string) => ipcRenderer.invoke('apiKeys:copy', id),
  apiKeysPeek: (id: string) => ipcRenderer.invoke('apiKeys:peek', id),
  apiKeysPeekAll: () => ipcRenderer.invoke('apiKeys:peekAll'),
  apiKeysUndoDelete: (id: string) => ipcRenderer.invoke('apiKeys:undoDelete', id),
  apiKeysScan: (onlyRoots?: string[]) => ipcRenderer.invoke('apiKeys:scan', onlyRoots),
  apiKeysDiscover: () => ipcRenderer.invoke('apiKeys:discover'),
  apiKeysSaveCandidates: (ids: string[]) => ipcRenderer.invoke('apiKeys:saveCandidates', ids),
  apiKeysDismissCandidates: (ids: string[]) => ipcRenderer.invoke('apiKeys:dismissCandidates', ids),
  apiKeysScanPick: () => ipcRenderer.invoke('apiKeys:scanPick'),
  apiKeysAddScanRoot: () => ipcRenderer.invoke('apiKeys:addScanRoot'),
  apiKeysRemoveScanRoot: (root: string) => ipcRenderer.invoke('apiKeys:removeScanRoot', root),
  apiKeysOpenScanRoot: (root: string) => ipcRenderer.invoke('apiKeys:openScanRoot', root),
  apiKeysRefreshUsage: () => ipcRenderer.invoke('apiKeys:refreshUsage'),
  apiKeysCheck: () => ipcRenderer.invoke('apiKeys:check'),
  apiKeysUndoEnv: () => ipcRenderer.invoke('apiKeys:undoEnv'),

  // ═══════════════════════════════════════════
  // 정리 (unsaved work, background jobs, heavy folders)
  // ═══════════════════════════════════════════
  tidyReport: (refresh?: boolean) => ipcRenderer.invoke('tidy:report', refresh),
  tidyBadge: () => ipcRenderer.invoke('tidy:badge'),
  onTidyBadge: (callback: (payload: { count: number; old: number }) => void) => {
    const listener = (_event: unknown, payload: { count: number; old: number }) => callback(payload)
    ipcRenderer.on('tidy:badge', listener)
    return () => ipcRenderer.removeListener('tidy:badge', listener)
  },
  tidyOpen: (target: string) => ipcRenderer.invoke('tidy:open', target),
  tidyStop: (pid: number) => ipcRenderer.invoke('tidy:stop', pid),
  tidyTrash: (target: string) => ipcRenderer.invoke('tidy:trash', target),
  tidyPruneWorktrees: (repo: string) => ipcRenderer.invoke('tidy:pruneWorktrees', repo),

  // ═══════════════════════════════════════════
  // Operations center
  // ═══════════════════════════════════════════
  getAppSettings: () => ipcRenderer.invoke('operations:settings:get'),
  saveAppSettings: (settings: any) => ipcRenderer.invoke('operations:settings:save', settings),
  backupDatabase: () => ipcRenderer.invoke('operations:backup'),
  listBackups: () => ipcRenderer.invoke('operations:backups:list'),
  restoreBackup: (name: string) => ipcRenderer.invoke('operations:backups:restore', name),
  getSystemStatus: () => ipcRenderer.invoke('operations:systemStatus'),
  getWorkspaceReport: (root: string) => ipcRenderer.invoke('operations:workspaceReport', root),
  runWorkspaceTests: (root: string) => ipcRenderer.invoke('operations:workspaceTests', root),
  listMaintenance: () => ipcRenderer.invoke('operations:maintenance:list'),
  updateMaintenance: (id: string, done: boolean) => ipcRenderer.invoke('operations:maintenance:update', id, done),
  listActivity: () => ipcRenderer.invoke('operations:activity:list'),
  changesUndoSkill: (plan: unknown) => ipcRenderer.invoke('changes:undoSkill', plan),
  saveTaskRequest: (input: any) => ipcRenderer.invoke('operations:taskRequests:save', input),
  listTaskRequests: () => ipcRenderer.invoke('operations:taskRequests:list'),
  listConnections: () => ipcRenderer.invoke('operations:connections:list'),
  createConnection: (input: any) => ipcRenderer.invoke('operations:connections:create', input),
  updateConnection: (id: string, input: any) => ipcRenderer.invoke('operations:connections:update', id, input),
  deleteConnection: (id: string) => ipcRenderer.invoke('operations:connections:delete', id),
  checkConnection: (id: string) => ipcRenderer.invoke('operations:connections:check', id),
  recordConnectionUsage: (id: string, input: any) => ipcRenderer.invoke('operations:connections:recordUsage', id, input),
  fetchConnectionUsage: (id: string) => ipcRenderer.invoke('operations:connections:fetchUsage', id),
  listRoadmap: () => ipcRenderer.invoke('operations:roadmap:list'),
  updateRoadmapTask: (id: string, status: string) => ipcRenderer.invoke('operations:roadmap:updateTask', id, status),
  
  // ═══════════════════════════════════════════
  // Emergency Stop
  // ═══════════════════════════════════════════
  triggerEmergencyStop: () => ipcRenderer.invoke('emergency:stop'),
  onEmergencyStop: (callback: () => void) => {
    ipcRenderer.on('dios:emergency-stop', callback)
    return () => ipcRenderer.removeListener('dios:emergency-stop', callback)
  },
})
