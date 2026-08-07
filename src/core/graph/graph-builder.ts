import { getDatabase } from '../../../electron/db/schema'

export interface GraphNode {
  id: string
  label: string
  type: 'project' | 'document' | 'experiment' | 'decision' | 'ai_resource' | 'human_gate'
  status?: string
}

export interface GraphEdge {
  source: string
  target: string
  label: string
  type: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function getGraphData(): GraphData {
  const db = getDatabase()
  
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Projects
  const projects = db.prepare('SELECT id, name, status FROM projects').all() as any[]
  for (const p of projects) {
    nodes.push({ id: p.id, label: p.name, type: 'project', status: p.status })
  }

  // Documents
  const documents = db.prepare('SELECT id, title, project_id, type FROM documents').all() as any[]
  for (const d of documents) {
    nodes.push({ id: d.id, label: d.title, type: 'document', status: d.type })
    edges.push({ source: d.project_id, target: d.id, label: 'contains', type: 'project-document' })
  }

  // Experiments
  const experiments = db.prepare('SELECT id, name, state FROM experiments').all() as any[]
  for (const e of experiments) {
    nodes.push({ id: e.id, label: e.name, type: 'experiment', status: e.state })
  }

  // Experiment transitions → edges between experiments (if any related)
  const transitions = db.prepare(`
    SELECT et.id, et.experiment_id, et.from_state, et.to_state
    FROM experiment_transitions et
    ORDER BY et.created_at ASC
  `).all() as any[]
  for (const t of transitions) {
    edges.push({
      source: t.experiment_id,
      target: t.experiment_id,
      label: `${t.from_state} → ${t.to_state}`,
      type: 'state-transition',
    })
  }

  // Decisions
  const decisions = db.prepare('SELECT id, topic, chosen_option FROM decision_ledger').all() as any[]
  for (const d of decisions) {
    nodes.push({ id: d.id, label: d.topic, type: 'decision', status: d.chosen_option })
  }

  // AI Resources
  const aiResources = db.prepare('SELECT id, name, provider, status FROM ai_resources').all() as any[]
  for (const r of aiResources) {
    nodes.push({ id: r.id, label: r.name, type: 'ai_resource', status: r.status })
  }

  // Human Gates
  const gates = db.prepare('SELECT id, name, level, enabled FROM human_gate_config').all() as any[]
  for (const g of gates) {
    nodes.push({ id: g.id, label: g.name, type: 'human_gate', status: g.enabled ? 'active' : 'disabled' })
  }

  return { nodes, edges }
}
