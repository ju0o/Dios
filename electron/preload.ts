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
  skillBoardGuide: (placeId: string, agentId: string, on: boolean) => ipcRenderer.invoke('skillBoard:guide', placeId, agentId, on),
  skillBoardHolders: (placeId: string, name: string) => ipcRenderer.invoke('skillBoard:holders', placeId, name),
  skillBoardReflect: (placeId: string, name: string, toIds: string[]) => ipcRenderer.invoke('skillBoard:reflect', placeId, name, toIds),

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
