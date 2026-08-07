import { useEffect, useState } from 'react'
import { MarkdownViewer, sanitizeHtml } from '../components/MarkdownViewer'

interface MemoryFile {
  path: string
  relPath: string
  content: string
  category: string
  modifiedAt: number
  size: number
}

type MemoryCategory = 'patterns' | 'projects' | 'sessions' | 'failures' | 'success'

export function MemoryView() {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<MemoryCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [memoryRoot, setMemoryRoot] = useState('E:\\Hermes\\memory')

  useEffect(() => {
    loadMemoryFiles()
  }, [])

  async function loadMemoryFiles() {
    try {
      const api = (window as any).electronAPI || {}
      const projectId = localStorage.getItem('dios:activeProject')
      const connections = projectId && typeof api.listProjectConnections === 'function' ? await api.listProjectConnections(projectId) : []
      const connectedRoot = connections?.find((connection: any) => connection.kind === 'memory')?.path
      const activeRoot = connectedRoot || 'E:\\Hermes\\memory'
      setMemoryRoot(activeRoot)
      const result = await api.scanRoots([activeRoot])
      
      const parsed: MemoryFile[] = result
        .filter((file: any) => file.path.endsWith('.md') || file.path.endsWith('.html'))
        .filter((file: any) => {
          const relPath = file.relPath
          return relPath.startsWith('patterns/') ||
                 relPath.startsWith('projects/') ||
                 relPath.startsWith('sessions/') ||
                 relPath.startsWith('failures/') ||
                 relPath.startsWith('success/')
        })
        .map((file: any) => {
          const category = file.relPath.split('/')[0] as MemoryCategory
          return {
            path: file.path,
            relPath: file.relPath,
            content: file.content,
            category,
            modifiedAt: file.updatedAt,
            size: file.content.length,
          }
        })

      setFiles(parsed)
    } catch (error) {
      console.error('메모리 파일 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  const categories: { id: MemoryCategory | 'all'; label: string; icon: string }[] = [
    { id: 'all', label: '전체', icon: '📁' },
    { id: 'patterns', label: '패턴', icon: '🔧' },
    { id: 'projects', label: '프로젝트', icon: '📊' },
    { id: 'sessions', label: '세션', icon: '📅' },
    { id: 'failures', label: '실패사례', icon: '⚠️' },
    { id: 'success', label: '성공사례', icon: '✅' },
  ]

  const filteredFiles = files
    .filter((file) => {
      if (selectedCategory !== 'all' && file.category !== selectedCategory) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          file.relPath.toLowerCase().includes(query) ||
          file.content.toLowerCase().includes(query)
        )
      }
      return true
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt)

  const categoryCounts = categories.reduce((acc, cat) => {
    acc[cat.id] = cat.id === 'all' ? files.length : files.filter((f) => f.category === cat.id).length
    return acc
  }, {} as Record<string, number>)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">메모리 파일 로딩 중...</div>
      </div>
    )
  }

  if (selectedFile) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <div className="glass-strong border-b border-white/10 px-8 py-6 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setSelectedFile(null)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
            >
              ← 뒤로
            </button>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-white/10 rounded text-sm text-gray-300">
                {categories.find((c) => c.id === selectedFile.category)?.icon}{' '}
                {categories.find((c) => c.id === selectedFile.category)?.label}
              </span>
              <span className="text-xs text-gray-500">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </span>
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">{selectedFile.relPath}</h1>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>수정: {new Date(selectedFile.modifiedAt).toLocaleString('ko-KR')}</span>
            <code className="font-mono">{selectedFile.path}</code>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-4xl mx-auto">
            {selectedFile.path.endsWith('.md') ? (
              <MarkdownViewer content={selectedFile.content} />
            ) : (
              <div
                className="prose prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedFile.content) }}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">📚 메모리 탐색</h1>
        <p className="text-gray-400">{files.length}개 파일 · {memoryRoot}</p>
      </div>

      {/* Search */}
      <div className="glass rounded-xl p-4 mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
          placeholder="파일명, 내용으로 검색..."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Categories */}
        <div className="lg:col-span-1">
          <div className="glass rounded-xl p-4 sticky top-8">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">카테고리</h3>
            <div className="space-y-1">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${
                    selectedCategory === cat.id
                      ? 'bg-white/10 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>
                    {cat.icon} {cat.label}
                  </span>
                  <span className="text-xs text-gray-500">{categoryCounts[cat.id]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3">
          <div className="mb-4 text-sm text-gray-400">
            {filteredFiles.length}개 파일 표시
          </div>

          {filteredFiles.length === 0 ? (
            <div className="glass rounded-xl p-12 text-center text-gray-500">
              검색 결과가 없습니다
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredFiles.map((file) => {
                const cat = categories.find((c) => c.id === file.category)
                return (
                  <div
                    key={file.path}
                    onClick={() => setSelectedFile(file)}
                    className="glass rounded-xl p-6 hover:border-white/20 cursor-pointer transition-all hover:scale-105"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-lg font-semibold flex-1 pr-2">{file.relPath}</h3>
                      <span className="text-2xl">{cat?.icon}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                      <span className="px-2 py-1 bg-white/5 rounded">{cat?.label}</span>
                      <span>{(file.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <p className="text-sm text-gray-400 line-clamp-3">
                      {file.content.substring(0, 200)}...
                    </p>
                    <div className="mt-3 text-xs text-gray-500">
                      수정: {new Date(file.modifiedAt).toLocaleDateString('ko-KR')}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
