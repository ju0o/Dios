import { useEffect, useState } from 'react'

interface TimelineEvent {
  id: string
  type: 'project' | 'document' | 'decision' | 'experiment'
  title: string
  timestamp: string
  description?: string
}

export function TimelineView() {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadTimeline() {
      try {
        // TODO: electronAPI.getTimeline() 구현 후 연동
        // 임시 데이터
        setEvents([
          { id: '1', type: 'project', title: 'DIOS 프로젝트 생성', timestamp: '2026-08-01 09:00', description: '프로젝트 초기화 완료' },
          { id: '2', type: 'document', title: '문서 3개 스캔', timestamp: '2026-08-01 09:15', description: 'Markdown, JSON, YAML 파일 스캔' },
          { id: '3', type: 'decision', title: '의사결정 승인', timestamp: '2026-08-01 10:00', description: 'AI 리소스 할당 결정' },
        ])
      } catch (error) {
        console.error('타임라인 로드 실패:', error)
      } finally {
        setLoading(false)
      }
    }
    loadTimeline()
  }, [])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-screen">
        <div className="text-white text-xl">타임라인 로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-8">📅 타임라인</h1>
      
      <div className="space-y-4">
        {events.length === 0 ? (
          <div className="text-gray-500 text-center py-12">
            이벤트가 없습니다
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex items-start gap-4 hover:bg-gray-850 transition"
            >
              <div className="text-3xl">
                {event.type === 'project' && '📁'}
                {event.type === 'document' && '📄'}
                {event.type === 'decision' && '⚖️'}
                {event.type === 'experiment' && '🧪'}
              </div>
              <div className="flex-1">
                <div className="text-white font-semibold text-lg">{event.title}</div>
                {event.description && (
                  <div className="text-gray-400 text-sm mt-1">{event.description}</div>
                )}
                <div className="text-sm text-gray-500 mt-2">{event.timestamp}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
