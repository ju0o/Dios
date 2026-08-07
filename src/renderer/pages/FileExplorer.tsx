import { useEffect, useRef, useState } from 'react'
import { useScan } from '../stores/scanStore'
import { useEmergencyStop } from '../stores/emergencyStore'

export function FileExplorer() {
  const { roots, setRoots, setFiles } = useScan()
  const { state, registerLoop } = useEmergencyStop()
  const [newRoot, setNewRoot] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanCount, setScanCount] = useState(0)
  const scanTokenRef = useRef(0)

  useEffect(() => registerLoop(() => {
    scanTokenRef.current += 1
    setLoading(false)
  }), [registerLoop])

  async function handleScan(rootsToScan?: string[]) {
    if (state.stopped) return
    const targets = rootsToScan || roots
    if (targets.length === 0) {
      setFiles([])
      setScanCount(0)
      return
    }

    const token = ++scanTokenRef.current
    setLoading(true)
    try {
      const result = await (window as any).electronAPI.scanRoots(targets)
      if (token !== scanTokenRef.current || state.stopped) return
      setFiles(result || [])
      setScanCount((result || []).length)
    } catch (error) {
      console.error('스캔 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  function addRoot() {
    if (!newRoot.trim()) return
    const updated = [...roots, newRoot.trim()]
    setRoots(updated)
    localStorage.setItem('dios:scanRoots', JSON.stringify(updated))
    setNewRoot('')
    handleScan(updated)
  }

  function removeRoot(root: string) {
    const updated = roots.filter((r) => r !== root)
    setRoots(updated)
    localStorage.setItem('dios:scanRoots', JSON.stringify(updated))
    handleScan(updated)
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">📁 폴더 스캔</h1>
        <p className="text-gray-400">마크다운/HTML 파일을 스캔할 폴더를 추가하세요</p>
      </div>

      {/* Root Folders */}
      <div className="glass rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">스캔 폴더</h2>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newRoot}
            onChange={(e) => setNewRoot(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRoot()}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
            placeholder="폴더 경로 (예: E:\Hermes\memory)"
          />
          <button
            onClick={addRoot}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-all"
          >
            추가
          </button>
        </div>
        {roots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {roots.map((root) => (
              <div
                key={root}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg"
              >
                <code className="text-sm text-gray-300 font-mono">{root}</code>
                <button
                  onClick={() => removeRoot(root)}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scan Button */}
      <div className="glass rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold mb-1">스캔 실행</h3>
            <p className="text-sm text-gray-400">
              {roots.length > 0
                ? `${roots.length}개 폴더를 스캔합니다`
                : '폴더를 추가해주세요'}
            </p>
          </div>
          <button
            onClick={() => handleScan()}
            disabled={loading || roots.length === 0 || state.stopped}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
          >
            {state.stopped ? '정지 상태' : loading ? '스캔 중...' : '스캔 시작'}
          </button>
        </div>
        {scanCount > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-sm text-gray-400">
              ✓ <span className="text-green-400 font-semibold">{scanCount}개</span> 파일 스캔 완료
            </p>
            <p className="text-xs text-gray-500 mt-1">
              '탐색' 탭에서 파일 트리를 볼 수 있습니다
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
