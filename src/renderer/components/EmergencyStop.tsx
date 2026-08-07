import { useState, useEffect, useRef } from 'react'
import { useEmergencyStop } from '../stores/emergencyStore'

export function EmergencyStop() {
  const { state, trigger, reset } = useEmergencyStop()
  const [isArmed, setIsArmed] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearCountdown = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    // electronAPI 이벤트 리스너 등록
    const cleanup = (window as any).electronAPI?.onEmergencyStop?.(() => {
      clearCountdown()
      setIsArmed(false)
      setCountdown(null)
      trigger('Electron에서 비상 정지 신호를 받았습니다.')
    })
    return () => {
      clearCountdown()
      cleanup?.()
    }
  }, [trigger])

  useEffect(() => () => clearCountdown(), [])

  const handleArm = () => {
    clearCountdown()
    setIsArmed(true)
    setCountdown(5)
    
    let count = 5
    timerRef.current = setInterval(() => {
      count--
      setCountdown(count)
      if (count === 0) {
        clearCountdown()
        triggerEmergencyStop()
      }
    }, 1000)
  }

  const handleDisarm = () => {
    clearCountdown()
    setIsArmed(false)
    setCountdown(null)
  }

  const triggerEmergencyStop = () => {
    console.log('🚨 EMERGENCY STOP TRIGGERED')
    trigger('사용자가 비상 정지를 실행했습니다.')
    // electronAPI로 비상 정지 이벤트 전송
    if ((window as any).electronAPI?.triggerEmergencyStop) {
      (window as any).electronAPI.triggerEmergencyStop()
    }
    setIsArmed(false)
    setCountdown(null)
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {state.stopped ? (
        <div className="bg-red-950 border border-red-500/60 text-red-100 px-5 py-4 rounded-xl shadow-lg max-w-xs">
          <div className="font-semibold">⛔ 작업 정지 상태</div>
          <p className="text-xs text-red-200/70 mt-1">새 작업을 시작하기 전에 상태를 초기화하세요.</p>
          <button onClick={reset} className="mt-3 bg-white text-red-700 px-4 py-1 rounded text-sm font-semibold hover:bg-gray-100">정지 해제</button>
        </div>
      ) : !isArmed ? (
        <button
          onClick={handleArm}
          className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold shadow-lg transition-all"
        >
          🚨 비상 정지
        </button>
      ) : (
        <div className="bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg">
          <div className="font-semibold">비상 정지 {countdown}초 후 실행</div>
          <button
            onClick={handleDisarm}
            className="mt-2 bg-white text-red-600 px-4 py-1 rounded text-sm font-semibold hover:bg-gray-100"
          >
            취소
          </button>
        </div>
      )}
    </div>
  )
}
