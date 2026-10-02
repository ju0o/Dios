import { useEffect, useState } from 'react'
import { isWorkListOn, setWorkListOn } from '../../core/founder-work/work-hold'

const DEFAULT_SETTINGS = {
  autoScan: true,
  scanInterval: 30,
  aiProvider: 'qwen',
  humanGateTimeout: 60,
  backupRetentionDays: 30,
}

export function Settings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [workOn, setWorkOn] = useState(() => isWorkListOn(typeof window === 'undefined' ? null : window.localStorage))

  /** 지금 할 일 is parked by default; this switch brings it back to the first screen and main menu. */
  function toggleWork(on: boolean) {
    setWorkListOn(window.localStorage, on)
    setWorkOn(on)
    window.dispatchEvent(new Event('dios:work-hold'))
  }

  useEffect(() => {
    async function loadSettings() {
      try {
        const api = (window as any).electronAPI
        if (typeof api?.getAppSettings === 'function') {
          setSettings({ ...DEFAULT_SETTINGS, ...(await api.getAppSettings()) })
          return
        }
        const stored = localStorage.getItem('dios:settings')
        if (stored) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) })
      } catch {
        setError('저장된 설정을 읽지 못해 기본값을 사용합니다.')
      }
    }
    loadSettings()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      setError('')
      const safeSettings = {
        ...settings,
        scanInterval: Math.max(1, Number(settings.scanInterval) || 30),
        humanGateTimeout: Math.max(1, Number(settings.humanGateTimeout) || 60),
        backupRetentionDays: Math.max(1, Number(settings.backupRetentionDays) || 30),
      }
      const api = (window as any).electronAPI
      if (typeof api?.saveAppSettings === 'function') {
        await api.saveAppSettings(safeSettings)
      } else {
        localStorage.setItem('dios:settings', JSON.stringify(safeSettings))
      }
      setSettings(safeSettings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('설정 저장 실패:', error)
      setError('설정을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-8">설정</h1>
      
      <div className="space-y-6 max-w-2xl">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-2">화면</h2>
          <p className="text-sm text-gray-400 mb-4">지금 할 일 화면은 목록이 스스로 정리되지 않아 잠시 쉬고 있어요. 켜면 첫 화면과 왼쪽 메뉴에 다시 나와요.</p>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={workOn} onChange={(e) => toggleWork(e.target.checked)} className="w-5 h-5" />
            <span className="text-white">지금 할 일 화면 켜기</span>
          </label>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">스캔 설정</h2>
          
          <div className="space-y-4">
            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.autoScan}
                  onChange={(e) => setSettings({ ...settings, autoScan: e.target.checked })}
                  className="w-5 h-5"
                />
                <span className="text-white">자동 스캔 활성화</span>
              </label>
            </div>
            
            <div>
              <label className="text-sm text-gray-400 block mb-2">스캔 간격 (분)</label>
              <input
                type="number"
                value={settings.scanInterval}
                onChange={(e) => setSettings({ ...settings, scanInterval: Number(e.target.value) || 0 })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
              />
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">백업 보관 정책</h2>
          <label className="text-sm text-gray-400 block mb-2">백업 보관 기간 (일)</label>
          <input type="number" min="1" value={settings.backupRetentionDays} onChange={(e) => setSettings({ ...settings, backupRetentionDays: Number(e.target.value) || 0 })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white" />
          <p className="text-xs text-gray-500 mt-2">새 백업을 만들 때 이 기간보다 오래된 백업을 자동으로 정리합니다.</p>
        </div>
        
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">AI 설정</h2>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 block mb-2">AI Provider</label>
              <select
                value={settings.aiProvider}
                onChange={(e) => setSettings({ ...settings, aiProvider: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
              >
                <option value="qwen">Qwen 3.7-Plus</option>
                <option value="groq">Groq</option>
                <option value="llama">Llama 3.1 70B</option>
              </select>
            </div>
          </div>
        </div>
        
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">Human Gate 설정</h2>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 block mb-2">타임아웃 (분)</label>
              <input
                type="number"
                value={settings.humanGateTimeout}
                onChange={(e) => setSettings({ ...settings, humanGateTimeout: Number(e.target.value) || 0 })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
              />
            </div>
          </div>
        </div>
        
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-bg disabled:text-text-muted px-6 py-3 rounded-lg font-semibold transition"
        >
          {saving ? '저장 중...' : saved ? '저장했어요' : '설정 저장'}
        </button>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <p className="text-xs text-gray-500">설정은 이 컴퓨터의 DIOS 데이터베이스에 저장됩니다. API 키는 연동 화면에서 로컬 저장 여부를 확인하세요.</p>
      </div>
    </div>
  )
}
