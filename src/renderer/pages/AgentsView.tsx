import { useEffect, useState } from 'react'
import { MarkdownViewer } from '../components/MarkdownViewer'

interface Agent {
  name: string
  path: string
  content: string
  description: string
  modifiedAt: number
  size: number
}

export function AgentsView() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareList, setCompareList] = useState<string[]>([])

  useEffect(() => {
    loadAgents()
  }, [])

  async function loadAgents() {
    try {
      const agentsRoot = 'E:\\Hermes\\memory\\agents'
      const result = await (window as any).electronAPI.scanRoots([agentsRoot])
      
      const parsed: Agent[] = result
        .filter((file: any) => file.path.endsWith('.md'))
        .map((file: any) => {
          const name = file.relPath.replace('.md', '')
          const lines = file.content.split('\n')
          const descMatch = lines.find((l: string) => l.startsWith('# '))
          const description = descMatch ? descMatch.replace('# ', '').trim() : name

          return {
            name,
            path: file.path,
            content: file.content,
            description,
            modifiedAt: file.updatedAt,
            size: file.content.length,
          }
        })

      setAgents(parsed)
    } catch (error) {
      console.error('에이전트 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  function toggleCompare(agentPath: string) {
    if (compareList.includes(agentPath)) {
      setCompareList(compareList.filter((p) => p !== agentPath))
    } else if (compareList.length < 4) {
      setCompareList([...compareList, agentPath])
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">에이전트 로딩 중...</div>
      </div>
    )
  }

  if (compareMode && compareList.length > 0) {
    const compareAgents = agents.filter((a) => compareList.includes(a.path))
    return (
      <div className="p-8 animate-fade-in">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">🔍 에이전트 비교</h1>
            <p className="text-gray-400">{compareAgents.length}개 에이전트 비교 중</p>
          </div>
          <button
            onClick={() => {
              setCompareMode(false)
              setCompareList([])
            }}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
          >
            ← 목록으로
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {compareAgents.map((agent) => (
            <div key={agent.path} className="glass rounded-xl overflow-hidden flex flex-col max-h-[800px]">
              <div className="p-4 border-b border-white/10 flex-shrink-0">
                <h3 className="text-lg font-semibold mb-2">{agent.name}</h3>
                <div className="text-xs text-gray-500">
                  {(agent.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <MarkdownViewer content={agent.content} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (selectedAgent) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <div className="glass-strong border-b border-white/10 px-8 py-6 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setSelectedAgent(null)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
            >
              ← 뒤로
            </button>
            <span className="text-xs text-gray-500">
              {(selectedAgent.size / 1024).toFixed(1)} KB
            </span>
          </div>
          <h1 className="text-3xl font-bold mb-2">{selectedAgent.name}</h1>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>수정: {new Date(selectedAgent.modifiedAt).toLocaleString('ko-KR')}</span>
            <code className="font-mono">{selectedAgent.path}</code>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-4xl mx-auto">
            <MarkdownViewer content={selectedAgent.content} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">🤖 에이전트 관리</h1>
          <p className="text-gray-400">{agents.length}개 에이전트</p>
        </div>
        {compareList.length > 0 && (
          <button
            onClick={() => setCompareMode(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-all"
          >
            🔍 비교 ({compareList.length})
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.path}
            className="glass rounded-xl p-6 hover:border-white/20 cursor-pointer transition-all hover:scale-105"
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-xl font-semibold">{agent.name}</h3>
              <input
                type="checkbox"
                checked={compareList.includes(agent.path)}
                onChange={() => toggleCompare(agent.path)}
                className="w-4 h-4"
                title="비교에 추가"
              />
            </div>
            <p className="text-sm text-gray-400 mb-3 line-clamp-2">{agent.description}</p>
            <div className="flex items-center gap-3 text-xs text-gray-500 mb-4">
              <span>{(agent.size / 1024).toFixed(1)} KB</span>
              <span>수정: {new Date(agent.modifiedAt).toLocaleDateString('ko-KR')}</span>
            </div>
            <button
              onClick={() => setSelectedAgent(agent)}
              className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
            >
              자세히 보기 →
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
