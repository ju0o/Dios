import { useState } from 'react'

interface HumanGateModalProps {
  gate: {
    id: string
    actionType: string
    description: string
    timeoutMinutes: number
  }
  onApprove: () => void
  onReject: () => void
}

export function HumanGateModal({ gate, onApprove, onReject }: HumanGateModalProps) {
  const [comment, setComment] = useState('')

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-2xl w-full mx-4">
        <h2 className="text-2xl font-bold text-white mb-4">
          🛡️ Human Gate 승인 필요
        </h2>
        
        <div className="space-y-4 mb-6">
          <div>
            <label className="text-sm text-gray-400">작업 유형</label>
            <div className="text-white font-semibold">{gate.actionType}</div>
          </div>
          
          <div>
            <label className="text-sm text-gray-400">설명</label>
            <div className="text-white">{gate.description}</div>
          </div>
          
          <div>
            <label className="text-sm text-gray-400">타임아웃</label>
            <div className="text-white">{gate.timeoutMinutes}분</div>
          </div>
          
          <div>
            <label className="text-sm text-gray-400">코멘트 (선택)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
              rows={3}
              placeholder="승인/거부 사유를 입력하세요..."
            />
          </div>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={onApprove}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold"
          >
            ✅ 승인
          </button>
          <button
            onClick={onReject}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold"
          >
            ❌ 거부
          </button>
        </div>
      </div>
    </div>
  )
}
