import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'

const NODE_COLORS: Record<string, string> = {
  project: '#3b82f6',
  document: '#8b5cf6',
  experiment: '#f59e0b',
  decision: '#10b981',
  ai_resource: '#06b6d4',
  human_gate: '#ef4444',
}

const NODE_ICONS: Record<string, string> = {
  project: '◈',
  document: '◉',
  experiment: '⬡',
  decision: '◆',
  ai_resource: '⬢',
  human_gate: '⊘',
}

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [stats, setStats] = useState({ nodes: 0, edges: 0 })
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    async function loadGraph() {
      try {
        const data = await (window as any).electronAPI.getGraphData()
        const nodes = data?.nodes || []
        const edges = data?.edges || []

        setStats({ nodes: nodes.length, edges: edges.length })

        if (!containerRef.current || nodes.length === 0) return

        // Clear previous content
        containerRef.current.innerHTML = ''

        const cy = cytoscape({
          container: containerRef.current,
          elements: [
            ...nodes.map((n: any) => ({
              data: {
                id: n.id,
                label: `${NODE_ICONS[n.type] || '●'} ${n.label}`,
                type: n.type,
                status: n.status || '',
              },
            })),
            ...edges.map((e: any) => ({
              data: {
                source: e.source,
                target: e.target,
                label: e.label || '',
              },
            })),
          ],
          style: [
            {
              selector: 'node',
              style: {
                'background-color': (ele: any) => NODE_COLORS[ele.data('type')] || '#6b7280',
                'label': 'data(label)',
                'color': '#e5e7eb',
                'font-size': '11px',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'text-margin-y': 8,
                'width': 32,
                'height': 32,
                'border-width': 2,
                'border-color': '#1f2937',
                'text-outline-width': 0,
              } as any,
            },
            {
              selector: 'node[type="project"]',
              style: {
                'width': 48,
                'height': 48,
                'font-size': '13px',
                'font-weight': 'bold',
              } as any,
            },
            {
              selector: 'node[type="human_gate"]',
              style: {
                'shape': 'diamond',
              } as any,
            },
            {
              selector: 'node[type="decision"]',
              style: {
                'shape': 'round-rectangle',
              } as any,
            },
            {
              selector: 'edge',
              style: {
                'width': 1.5,
                'line-color': '#374151',
                'target-arrow-color': '#4b5563',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'arrow-scale': 0.8,
                'opacity': 0.6,
              } as any,
            },
            {
              selector: ':selected',
              style: {
                'border-width': 3,
                'border-color': '#60a5fa',
                'opacity': 1,
              } as any,
            },
          ],
          layout: {
            name: 'cose',
            padding: 30,
            nodeRepulsion: () => 8000,
            idealEdgeLength: () => 100,
            gravity: 0.25,
          },
          userZoomingEnabled: true,
          userPanningEnabled: true,
          boxSelectionEnabled: false,
        })

        // Apply filter
        if (filter !== 'all') {
          cy.elements().forEach((ele) => {
            if (ele.isNode() && ele.data('type') !== filter) {
              ele.style('opacity', 0.15)
            }
          })
        }
      } catch (error) {
        console.error('그래프 로드 실패:', error)
      }
    }
    loadGraph()
  }, [filter])

  const nodeTypes = [
    { key: 'all', label: '전체', color: '#6b7280' },
    { key: 'project', label: '프로젝트', color: NODE_COLORS.project },
    { key: 'document', label: '문서', color: NODE_COLORS.document },
    { key: 'experiment', label: '실험', color: NODE_COLORS.experiment },
    { key: 'decision', label: '의사결정', color: NODE_COLORS.decision },
    { key: 'ai_resource', label: 'AI 리소스', color: NODE_COLORS.ai_resource },
    { key: 'human_gate', label: '휴먼 게이트', color: NODE_COLORS.human_gate },
  ]

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-8">🕸️ 그래프 뷰</h1>
      
      {/* Stats */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6">
          <div className="text-3xl font-bold text-blue-400">{stats.nodes}</div>
          <div className="text-sm text-gray-400">노드</div>
        </div>
        <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6">
          <div className="text-3xl font-bold text-green-400">{stats.edges}</div>
          <div className="text-sm text-gray-400">엣지</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {nodeTypes.map((nt) => (
          <button
            key={nt.key}
            onClick={() => setFilter(nt.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === nt.key
                ? 'bg-white/10 text-white border border-white/20'
                : 'bg-gray-900/50 text-gray-400 border border-gray-800 hover:border-gray-700'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: nt.color }} />
            {nt.label}
          </button>
        ))}
      </div>
      
      {/* Graph Container */}
      <div
        ref={containerRef}
        className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl h-[600px]"
      >
        {stats.nodes === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            그래프 데이터가 없습니다. 프로젝트와 문서를 추가하세요.
          </div>
        )}
      </div>
    </div>
  )
}
