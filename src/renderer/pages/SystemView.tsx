import { useEffect, useState } from 'react'
import { MarkdownViewer, sanitizeHtml } from '../components/MarkdownViewer'

interface SystemFile {
  path: string
  relPath: string
  content: string
  modifiedAt: number
  size: number
}

export function SystemView() {
  const [files, setFiles] = useState<SystemFile[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<SystemFile | null>(null)

  useEffect(() => {
    loadSystemFiles()
  }, [])

  async function loadSystemFiles() {
    try {
      const systemRoot = 'E:\\Hermes\\memory\\system'
      const result = await (window as any).electronAPI.scanRoots([systemRoot])
      
      const parsed: SystemFile[] = result
        .filter((file: any) => file.path.endsWith('.md') || file.path.endsWith('.html'))
        .map((file: any) => ({
          path: file.path,
          relPath: file.relPath,
          content: file.content,
          modifiedAt: file.updatedAt,
          size: file.content.length,
        }))

      setFiles(parsed)
    } catch (error) {
      console.error('시스템 파일 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">시스템 파일 로딩 중...</div>
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
            <span className="text-xs text-gray-500">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </span>
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
        <h1 className="text-3xl font-bold mb-2">⚙️ 시스템 설정</h1>
        <p className="text-gray-400">{files.length}개 파일 · 시스템 구성</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {files.map((file) => (
          <div
            key={file.path}
            onClick={() => setSelectedFile(file)}
            className="glass rounded-xl p-6 hover:border-white/20 cursor-pointer transition-all hover:scale-105"
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-semibold">{file.relPath}</h3>
              <span className="text-2xl">⚙️</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
              <span>{(file.size / 1024).toFixed(1)} KB</span>
              <span>수정: {new Date(file.modifiedAt).toLocaleDateString('ko-KR')}</span>
            </div>
            <p className="text-sm text-gray-400 line-clamp-3">
              {file.content.substring(0, 200)}...
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
