import { getDatabase } from '../../../electron/db/schema'

export interface Document {
  id: string
  projectId: string
  title: string
  content: string
  type: string
  filePath?: string
  createdAt: string
  updatedAt: string
}

export function listDocuments(projectId?: string): Document[] {
  const db = getDatabase()
  if (projectId) {
    return db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Document[]
  }
  return db.prepare('SELECT * FROM documents ORDER BY updated_at DESC').all() as Document[]
}

export function saveDocument(doc: Omit<Document, 'createdAt' | 'updatedAt'>): Document {
  const db = getDatabase()
  const id = doc.id || crypto.randomUUID()
  const now = new Date().toISOString()
  
  db.prepare(`
    INSERT OR REPLACE INTO documents (id, project_id, title, content, type, file_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, doc.projectId, doc.title, doc.content, doc.type, doc.filePath || null, now, now)
  
  return { ...doc, id, createdAt: now, updatedAt: now }
}

export function searchDocuments(query: string, filters?: any): Document[] {
  const db = getDatabase()
  const searchTerm = `%${query}%`
  
  let sql = 'SELECT * FROM documents WHERE title LIKE ? OR content LIKE ?'
  const params: any[] = [searchTerm, searchTerm]
  
  if (filters?.projectId) {
    sql += ' AND project_id = ?'
    params.push(filters.projectId)
  }
  
  if (filters?.type) {
    sql += ' AND type = ?'
    params.push(filters.type)
  }
  
  sql += ' ORDER BY updated_at DESC'
  
  return db.prepare(sql).all(...params) as Document[]
}
