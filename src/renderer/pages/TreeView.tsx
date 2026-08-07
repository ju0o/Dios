import { useState } from 'react'
import { useScan } from '../stores/scanStore'
import { MarkdownViewer } from '../components/MarkdownViewer'

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
  file?: any
}

export function TreeView() {
  const { files } = useScan()
  const [selectedFile, setSelectedFile] = useState<any>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  function buildTree(inputFiles = files): TreeNode[] {
    const tree: TreeNode[] = []
    const dirMap = new Map<string, TreeNode>()

    const sortedFiles = [...inputFiles].sort((a, b) => a.relPath.localeCompare(b.relPath))

    for (const file of sortedFiles) {
      const parts = file.relPath.split(/[/\\]/)
      let currentPath = ''

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const parentPath = currentPath
        currentPath = currentPath ? `${currentPath}/${part}` : part

        if (i === parts.length - 1) {
          const fileNode: TreeNode = {
            name: part,
            path: currentPath,
            isDirectory: false,
            file,
          }

          if (parentPath && dirMap.has(parentPath)) {
            dirMap.get(parentPath)!.children!.push(fileNode)
          } else {
            tree.push(fileNode)
          }
        } else {
          if (!dirMap.has(currentPath)) {
            const dirNode: TreeNode = {
              name: part,
              path: currentPath,
              isDirectory: true,
              children: [],
            }
            dirMap.set(currentPath, dirNode)

            if (parentPath && dirMap.has(parentPath)) {
              dirMap.get(parentPath)!.children!.push(dirNode)
            } else {
              tree.push(dirNode)
            }
          }
        }
      }
    }

    return tree
  }

  function toggleDir(path: string) {
    const newExpanded = new Set(expandedDirs)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedDirs(newExpanded)
  }

  function renderTree(nodes: TreeNode[], depth: number = 0): React.ReactNode {
    return nodes.map((node) => {
      if (node.isDirectory) {
        const isExpanded = expandedDirs.has(node.path)
        return (
          <div key={node.path}>
            <div
              onClick={() => toggleDir(node.path)}
              className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer transition-colors"
              style={{ paddingLeft: `${depth * 16 + 12}px` }}
            >
              <span className="text-sm">{isExpanded ? '▼' : '▶'}</span>
              <span className="text-lg">📁</span>
              <span className="text-sm font-medium">{node.name}</span>
            </div>
            {isExpanded && node.children && (
              <div>{renderTree(node.children, depth + 1)}</div>
            )}
          </div>
        )
      } else {
        const isSelected = selectedFile?.path === node.file?.path
        return (
          <div
            key={node.path}
            onClick={() => node.file && setSelectedFile(node.file)}
            className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
              isSelected ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
            style={{ paddingLeft: `${depth * 16 + 12}px` }}
          >
            <span className="text-lg">
              {node.file?.path.endsWith('.md') ? '📝' : '🌐'}
            </span>
            <span className="text-sm">{node.name}</span>
          </div>
        )
      }
    })
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleFiles = normalizedQuery
    ? files.filter((file) => file.relPath.toLowerCase().includes(normalizedQuery) || file.content.toLowerCase().includes(normalizedQuery))
    : files
  const tree = buildTree(visibleFiles)

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-6xl mb-4">📂</div>
          <h2 className="text-xl font-semibold mb-2">스캔된 파일이 없습니다</h2>
          <p className="text-gray-400">
            '스캔' 탭에서 폴더를 추가하고 스캔해주세요
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">🌳 파일 탐색</h1>
        <p className="text-gray-400">{visibleFiles.length}/{files.length}개 파일</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tree */}
        <div className="lg:col-span-1 glass rounded-xl overflow-hidden">
          <div className="max-h-[700px] overflow-y-auto">
            {renderTree(tree)}
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-2 glass rounded-xl overflow-hidden">
          {selectedFile ? (
            <div className="flex flex-col h-full max-h-[800px]">
              <div className="p-6 border-b border-white/10 flex-shrink-0">
                <h2 className="text-2xl font-bold mb-2">{selectedFile.relPath}</h2>
                <code className="text-xs text-gray-500 font-mono block mb-3">{selectedFile.path}</code>
                <div className="flex gap-4 text-sm text-gray-400">
                  <span>{selectedFile.wordCount} 단어</span>
                  <span>수정: {new Date(selectedFile.updatedAt).toLocaleString('ko-KR')}</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {selectedFile.path.endsWith('.md') ? (
                  <MarkdownViewer content={selectedFile.content} />
                ) : (
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                    {selectedFile.content}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              파일을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
