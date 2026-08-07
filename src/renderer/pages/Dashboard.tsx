import { useEffect, useState } from 'react'

interface Project {
  id: string
  name: string
  description: string
  status: string
  created_at: string
  updated_at: string
}

interface Document {
  id: string
  project_id: string
  title: string
  content: string
  type: string
  file_path?: string
  created_at: string
  updated_at: string
}

type FilterType = 'all' | 'project' | 'document'
type FileTypeFilter = 'all' | 'markdown' | 'json' | 'yaml'
type DateFilter = 'all' | '7days' | '30days'
type SortType = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'created_desc'

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  
  // Filters
  const [filter, setFilter] = useState<FilterType>('all')
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [sortType, setSortType] = useState<SortType>('updated_desc')
  const [searchQuery, setSearchQuery] = useState('')
  
  // UI State
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<Project | Document | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const projectList = await (window as any).electronAPI.getProjects()
      setProjects(projectList || [])
      
      const allDocs: Document[] = []
      for (const project of projectList || []) {
        const docs = await (window as any).electronAPI.getDocuments(project.id)
        allDocs.push(...(docs || []))
      }
      setDocuments(allDocs)
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(type: 'project' | 'document') {
    if (type === 'project') {
      const name = prompt('프로젝트 이름:')
      if (!name) return
      const description = prompt('설명:') || ''
      
      try {
        await (window as any).electronAPI.createProject({ name, description })
        await loadData()
      } catch (error) {
        console.error('프로젝트 생성 실패:', error)
        alert('프로젝트 생성에 실패했습니다.')
      }
    } else {
      const projectId = prompt('프로젝트 ID:')
      if (!projectId) return
      const title = prompt('문서 제목:')
      if (!title) return
      const content = prompt('내용:') || ''
      const docType = prompt('타입 (markdown/json/yaml):') || 'markdown'
      
      try {
        await (window as any).electronAPI.saveDocument({
          projectId,
          title,
          content,
          type: docType,
        })
        await loadData()
      } catch (error) {
        console.error('문서 생성 실패:', error)
        alert('문서 생성에 실패했습니다.')
      }
    }
  }

  async function handleDelete() {
    if (!itemToDelete) return
    
    setShowDeleteConfirm(false)
    
    try {
      if ('project_id' in itemToDelete) {
        if (itemToDelete.file_path) {
          await (window as any).electronAPI.deleteFile(itemToDelete.file_path)
        }
        await (window as any).electronAPI.deleteDocument(itemToDelete.id)
        setSelectedDoc(null)
      } else {
        await (window as any).electronAPI.deleteProject(itemToDelete.id)
      }
      await loadData()
      setItemToDelete(null)
    } catch (error) {
      console.error('삭제 실패:', error)
      alert('삭제에 실패했습니다.')
    }
  }

  function getFilteredAndSortedItems() {
    let items: (Project | Document)[] = []
    
    // Type filter
    if (filter === 'all' || filter === 'project') {
      items = [...items, ...projects]
    }
    if (filter === 'all' || filter === 'document') {
      items = [...items, ...documents]
    }
    
    // File type filter (only for documents)
    if (fileTypeFilter !== 'all') {
      items = items.filter((item) => {
        if ('project_id' in item) {
          return item.type === fileTypeFilter
        }
        return true // Projects are not affected by file type filter
      })
    }
    
    // Project filter
    if (projectFilter !== 'all') {
      items = items.filter((item) => {
        if ('project_id' in item) {
          return item.project_id === projectFilter
        }
        return item.id === projectFilter
      })
    }
    
    // Date filter
    if (dateFilter !== 'all') {
      const now = Date.now()
      const days = dateFilter === '7days' ? 7 : 30
      const cutoff = now - days * 24 * 60 * 60 * 1000
      
      items = items.filter((item) => {
        const updatedAt = new Date(item.updated_at).getTime()
        return updatedAt >= cutoff
      })
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      items = items.filter((item) => {
        if ('project_id' in item) {
          return item.title.toLowerCase().includes(query) || 
                 item.content.toLowerCase().includes(query) ||
                 (item.file_path && item.file_path.toLowerCase().includes(query))
        } else {
          return item.name.toLowerCase().includes(query) || 
                 item.description.toLowerCase().includes(query)
        }
      })
    }
    
    // Sort
    items.sort((a, b) => {
      switch (sortType) {
        case 'updated_desc':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        case 'updated_asc':
          return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        case 'name_asc':
          const nameA = 'project_id' in a ? a.title : a.name
          const nameB = 'project_id' in b ? b.title : b.name
          return nameA.localeCompare(nameB)
        case 'name_desc':
          const nameA2 = 'project_id' in a ? a.title : a.name
          const nameB2 = 'project_id' in b ? b.title : b.name
          return nameB2.localeCompare(nameA2)
        case 'created_desc':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        default:
          return 0
      }
    })
    
    return items
  }

  function resetFilters() {
    setFilter('all')
    setFileTypeFilter('all')
    setProjectFilter('all')
    setDateFilter('all')
    setSortType('updated_desc')
    setSearchQuery('')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">데이터 로딩 중...</div>
      </div>
    )
  }

  const filteredItems = getFilteredAndSortedItems()
  const hasActiveFilters = filter !== 'all' || fileTypeFilter !== 'all' || projectFilter !== 'all' || dateFilter !== 'all' || searchQuery !== ''

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">📊 대시보드</h1>
        <p className="text-gray-400">문서를 탐색하고 관리하세요</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="프로젝트" value={projects.length} icon="📁" color="blue" />
        <StatCard title="문서" value={documents.length} icon="📄" color="green" />
        <StatCard title="Markdown" value={documents.filter(d => d.type === 'markdown').length} icon="📝" color="purple" />
        <StatCard title="JSON/YAML" value={documents.filter(d => d.type === 'json' || d.type === 'yaml').length} icon="📋" color="orange" />
      </div>

      {/* Search & Filter Toggle */}
      <div className="glass rounded-xl p-4 mb-4">
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="제목, 내용, 경로로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2 rounded-lg transition-all text-sm font-medium flex items-center gap-2 ${
              showFilters || hasActiveFilters
                ? 'bg-white/10 text-white border border-white/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            🔍 필터
            {hasActiveFilters && (
              <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">
                활성
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm font-medium transition-all"
            >
              필터 초기화
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => handleCreate('project')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-all"
            >
              + 프로젝트
            </button>
            <button
              onClick={() => handleCreate('document')}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium transition-all"
            >
              + 문서
            </button>
          </div>
        </div>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <div className="glass rounded-xl p-4 mb-4 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Type Filter */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">타입</label>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterType)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-white/20"
              >
                <option value="all">전체</option>
                <option value="project">프로젝트만</option>
                <option value="document">문서만</option>
              </select>
            </div>

            {/* File Type Filter */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">파일 타입</label>
              <select
                value={fileTypeFilter}
                onChange={(e) => setFileTypeFilter(e.target.value as FileTypeFilter)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-white/20"
              >
                <option value="all">전체</option>
                <option value="markdown">Markdown</option>
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
              </select>
            </div>

            {/* Project Filter */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">프로젝트</label>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-white/20"
              >
                <option value="all">전체 프로젝트</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Filter */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">날짜</label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-white/20"
              >
                <option value="all">전체 기간</option>
                <option value="7days">최근 7일</option>
                <option value="30days">최근 30일</option>
              </select>
            </div>
          </div>

          {/* Sort */}
          <div className="mt-4">
            <label className="text-sm text-gray-400 mb-2 block">정렬</label>
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'updated_desc', label: '수정일 ↓' },
                { value: 'updated_asc', label: '수정일 ↑' },
                { value: 'name_asc', label: '이름 A-Z' },
                { value: 'name_desc', label: '이름 Z-A' },
                { value: 'created_desc', label: '생성일 ↓' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSortType(option.value as SortType)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                    sortType === option.value
                      ? 'bg-white/10 text-white border border-white/20'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results Count */}
      <div className="mb-4 text-sm text-gray-400">
        {filteredItems.length}개 항목 표시
        {hasActiveFilters && ` (전체 ${projects.length + documents.length}개 중)`}
      </div>

      {/* Items List */}
      <div className="glass rounded-xl overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            {hasActiveFilters ? '필터 조건에 맞는 항목이 없습니다' : '항목이 없습니다. 새 프로젝트를 생성하세요.'}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => 'project_id' in item && setSelectedDoc(item)}
                className={`p-4 transition-all ${
                  'project_id' in item ? 'cursor-pointer hover:bg-white/5' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl flex-shrink-0">
                        {'project_id' in item ? '📄' : '📁'}
                      </span>
                      <h3 className="text-lg font-semibold truncate">
                        {'project_id' in item ? item.title : item.name}
                      </h3>
                      {'project_id' in item && (
                        <span className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400 flex-shrink-0">
                          {item.type}
                        </span>
                      )}
                    </div>
                    
                    {/* File Path */}
                    {'project_id' in item && item.file_path && (
                      <div className="ml-11 mb-2">
                        <code className="text-xs text-gray-500 font-mono bg-white/5 px-2 py-1 rounded">
                          {item.file_path}
                        </code>
                      </div>
                    )}
                    
                    {/* Content Preview */}
                    <p className="text-sm text-gray-400 ml-11 line-clamp-2">
                      {'project_id' in item 
                        ? item.content.slice(0, 200) + (item.content.length > 200 ? '...' : '')
                        : item.description}
                    </p>
                    
                    {/* Metadata */}
                    {'project_id' in item && (
                      <div className="ml-11 mt-2 flex gap-4 text-xs text-gray-500">
                        <span>📅 {new Date(item.updated_at).toLocaleDateString('ko-KR')}</span>
                        <span>📝 {item.content.split(/\s+/).length} 단어</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Actions */}
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setItemToDelete(item)
                        setShowDeleteConfirm(true)
                      }}
                      className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm transition-all"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Document Detail Modal */}
      {selectedDoc && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
          <div className="glass-strong rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex-shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-3xl">📄</span>
                    <h2 className="text-2xl font-bold truncate">{selectedDoc.title}</h2>
                    <span className="px-3 py-1 bg-white/10 rounded text-sm text-gray-300 flex-shrink-0">
                      {selectedDoc.type}
                    </span>
                  </div>
                  {selectedDoc.file_path && (
                    <code className="text-sm text-gray-400 font-mono bg-white/5 px-3 py-1 rounded block mt-2">
                      {selectedDoc.file_path}
                    </code>
                  )}
                </div>
                <button
                  onClick={() => setSelectedDoc(null)}
                  className="text-gray-400 hover:text-white text-2xl flex-shrink-0"
                >
                  ✕
                </button>
              </div>
              
              {/* Metadata */}
              <div className="flex gap-6 mt-4 text-sm text-gray-400 flex-wrap">
                <div>
                  <span className="text-gray-500">생성:</span>{' '}
                  {new Date(selectedDoc.created_at).toLocaleString('ko-KR')}
                </div>
                <div>
                  <span className="text-gray-500">수정:</span>{' '}
                  {new Date(selectedDoc.updated_at).toLocaleString('ko-KR')}
                </div>
                <div>
                  <span className="text-gray-500">단어 수:</span>{' '}
                  {selectedDoc.content.split(/\s+/).length}
                </div>
                <div>
                  <span className="text-gray-500">문자 수:</span>{' '}
                  {selectedDoc.content.length}
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                {selectedDoc.content}
              </pre>
            </div>
            
            {/* Footer */}
            <div className="p-6 border-t border-white/10 flex gap-3 justify-end flex-shrink-0">
              <button
                onClick={() => {
                  setItemToDelete(selectedDoc)
                  setShowDeleteConfirm(true)
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-all"
              >
                삭제
              </button>
              <button
                onClick={() => setSelectedDoc(null)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && itemToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="glass-strong rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4">삭제 확인</h3>
            <p className="text-gray-300 mb-6">
              정말로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setItemToDelete(null)
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all"
              >
                취소
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-all"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: string; color: string }) {
  const colors = {
    blue: 'from-blue-600/20 to-blue-700/20 border-blue-500/30',
    green: 'from-green-600/20 to-green-700/20 border-green-500/30',
    purple: 'from-purple-600/20 to-purple-700/20 border-purple-500/30',
    orange: 'from-orange-600/20 to-orange-700/20 border-orange-500/30',
  }
  
  return (
    <div className={`glass rounded-xl p-6 bg-gradient-to-br ${colors[color as keyof typeof colors]} border`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-3xl">{icon}</span>
        <span className="text-3xl font-bold">{value}</span>
      </div>
      <div className="text-sm text-gray-400">{title}</div>
    </div>
  )
}
