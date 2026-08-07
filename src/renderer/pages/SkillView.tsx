import { useEffect, useState } from 'react'
import { MarkdownViewer } from '../components/MarkdownViewer'

interface Skill {
  name: string
  category: string
  subcategory?: string
  description: string
  content: string
  path: string
  fileName: string
  modifiedAt: number
  size: number
  tags: string[]
  trigger?: string
  dependencies: string[]
  relatedSkills: string[]
  hash: string
}

interface Translation {
  title?: string
  description?: string
  content?: string
  sourceHash?: string
  updatedAt?: number
}

interface Translations {
  [skillPath: string]: Translation
}

type SortType = 'name' | 'category' | 'modified' | 'size' | 'usage'
type ViewMode = 'grid' | 'list'
type Language = 'en' | 'ko'

interface UsageStats {
  [key: string]: {
    count: number
    lastUsed: number
  }
}

interface CustomTag {
  skillPath: string
  tags: string[]
}

export function SkillView() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortType>('category')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [favorites, setFavorites] = useState<string[]>([])
  const [usageStats, setUsageStats] = useState<UsageStats>({})
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [compareList, setCompareList] = useState<string[]>([])
  const [showRelationGraph, setShowRelationGraph] = useState(false)
  const [customTags, setCustomTags] = useState<CustomTag[]>([])
  const [showGuide, setShowGuide] = useState(false)
  const [language, setLanguage] = useState<Language>('en')
  const [translations, setTranslations] = useState<Translations>({})
  const [editTranslation, setEditTranslation] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editContent, setEditContent] = useState('')
  const [skillRoot, setSkillRoot] = useState('C:\\Users\\user\\AppData\\Local\\hermes\\skills')

  useEffect(() => {
    loadSkills()
    loadFavorites()
    loadUsageStats()
    loadCustomTags()
    loadTranslations()
  }, [])

  async function loadSkills() {
    try {
      const api = (window as any).electronAPI || {}
      const projectId = localStorage.getItem('dios:activeProject')
      const connections = projectId && typeof api.listProjectConnections === 'function' ? await api.listProjectConnections(projectId) : []
      const connectedRoot = connections?.find((connection: any) => connection.kind === 'skills')?.path
      const activeRoot = connectedRoot || 'C:\\Users\\user\\AppData\\Local\\hermes\\skills'
      setSkillRoot(activeRoot)
      const result = await api.scanRoots([activeRoot])
      
      const parsed: Skill[] = result
        .filter((file: any) => file.path.endsWith('SKILL.md'))
        .map((file: any) => {
          const lines = file.content.split('\n')
          const nameMatch = lines.find((l: string) => l.startsWith('# '))
          const pathParts = file.relPath.split(/[\\/]/)
          const name = nameMatch ? nameMatch.replace('# ', '').trim() : pathParts[0]
          
          const category = pathParts[0] || 'uncategorized'
          const subcategory = pathParts[1]
          
          const descMatch = file.content.match(/description:\s*(.+)/i)
          const description = descMatch ? descMatch[1].trim() : ''

          const tagsMatch = file.content.match(/tags?:\s*\[(.*?)\]/i)
          const tags = tagsMatch ? tagsMatch[1].split(',').map((t: string) => t.trim()) : []

          const triggerMatch = file.content.match(/trigger:\s*(.+)/i)
          const trigger = triggerMatch ? triggerMatch[1].trim() : ''

          const depsMatch = file.content.match(/dependencies?:\s*\[(.*?)\]/i)
          const dependencies = depsMatch ? depsMatch[1].split(',').map((d: string) => d.trim()) : []

          const relatedMatch = file.content.match(/related?:\s*\[(.*?)\]/i)
          const relatedSkills = relatedMatch ? relatedMatch[1].split(',').map((r: string) => r.trim()) : []

          return {
            name,
            category,
            subcategory,
            description,
            content: file.content,
            path: file.path,
            fileName: file.relPath,
            modifiedAt: file.updatedAt,
            size: file.content.length,
            tags,
            trigger,
            dependencies,
            relatedSkills,
            hash: file.hash,
          }
        })

      setSkills(parsed)
    } catch (error) {
      console.error('스킬 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  function loadFavorites() {
    const saved = localStorage.getItem('dios:skillFavorites')
    if (saved) setFavorites(JSON.parse(saved))
  }

  function saveFavorites(newFavorites: string[]) {
    setFavorites(newFavorites)
    localStorage.setItem('dios:skillFavorites', JSON.stringify(newFavorites))
  }

  function toggleFavorite(path: string) {
    const newFavorites = favorites.includes(path)
      ? favorites.filter((p) => p !== path)
      : [...favorites, path]
    saveFavorites(newFavorites)
  }

  function loadUsageStats() {
    const saved = localStorage.getItem('dios:skillUsage')
    if (saved) setUsageStats(JSON.parse(saved))
  }

  function recordUsage(path: string) {
    const newStats = { ...usageStats }
    if (!newStats[path]) newStats[path] = { count: 0, lastUsed: 0 }
    newStats[path].count++
    newStats[path].lastUsed = Date.now()
    setUsageStats(newStats)
    localStorage.setItem('dios:skillUsage', JSON.stringify(newStats))
  }

  function loadCustomTags() {
    const saved = localStorage.getItem('dios:customTags')
    if (saved) setCustomTags(JSON.parse(saved))
  }

  function addCustomTag(skillPath: string, tag: string) {
    const newTags = [...customTags]
    const existing = newTags.find((t) => t.skillPath === skillPath)
    if (existing) {
      if (!existing.tags.includes(tag)) existing.tags.push(tag)
    } else {
      newTags.push({ skillPath, tags: [tag] })
    }
    setCustomTags(newTags)
    localStorage.setItem('dios:customTags', JSON.stringify(newTags))
  }

  function removeCustomTag(skillPath: string, tag: string) {
    const newTags = customTags
      .map((t) => {
        if (t.skillPath === skillPath) {
          return { ...t, tags: t.tags.filter((tagToRemove) => tagToRemove !== tag) }
        }
        return t
      })
      .filter((t) => t.tags.length > 0)
    setCustomTags(newTags)
    localStorage.setItem('dios:customTags', JSON.stringify(newTags))
  }

  function getCustomTagsForSkill(skillPath: string): string[] {
    const custom = customTags.find((t) => t.skillPath === skillPath)
    return custom ? custom.tags : []
  }

  function toggleCompare(skillPath: string) {
    if (compareList.includes(skillPath)) {
      setCompareList(compareList.filter((p) => p !== skillPath))
    } else if (compareList.length < 4) {
      setCompareList([...compareList, skillPath])
    }
  }

  function loadTranslations() {
    const saved = localStorage.getItem('dios:translations')
    if (saved) setTranslations(JSON.parse(saved))
  }

  function saveTranslation(skillPath: string, translation: Translation) {
    const newTranslations = { ...translations, [skillPath]: translation }
    setTranslations(newTranslations)
    localStorage.setItem('dios:translations', JSON.stringify(newTranslations))
  }

  function getTranslation(skillPath: string): Translation | undefined {
    return translations[skillPath]
  }

  function startEditTranslation(skill: Skill) {
    const trans = getTranslation(skill.path)
    setEditTitle(trans?.title || '')
    setEditDescription(trans?.description || '')
    setEditContent(trans?.content || '')
    setEditTranslation(true)
  }

  function saveEditTranslation() {
    if (!selectedSkill) return
    saveTranslation(selectedSkill.path, {
      title: editTitle,
      description: editDescription,
      content: editContent,
      sourceHash: selectedSkill.hash,
      updatedAt: Date.now(),
    })
    setEditTranslation(false)
  }

  const handleSkillClick = (skill: Skill) => {
    setSelectedSkill(skill)
    setEditTranslation(false)
    recordUsage(skill.path)
  }

  const categories = ['all', ...Array.from(new Set(skills.map((s) => s.category))).sort()]
  const allTags = Array.from(new Set(skills.flatMap((s) => s.tags))).sort()

  const filteredSkills = skills
    .filter((skill) => {
      if (showFavoritesOnly && !favorites.includes(skill.path)) return false
      if (selectedCategory !== 'all' && skill.category !== selectedCategory) return false
      if (selectedTags.length > 0 && !selectedTags.some((tag) => skill.tags.includes(tag))) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const trans = getTranslation(skill.path)
        return (
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query) ||
          skill.content.toLowerCase().includes(query) ||
          skill.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          getCustomTagsForSkill(skill.path).some((tag) => tag.toLowerCase().includes(query)) ||
          (trans?.title && trans.title.toLowerCase().includes(query)) ||
          (trans?.description && trans.description.toLowerCase().includes(query))
        )
      }
      return true
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'category':
          return a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
        case 'modified':
          return b.modifiedAt - a.modifiedAt
        case 'size':
          return b.size - a.size
        case 'usage':
          const aUsage = usageStats[a.path]?.count || 0
          const bUsage = usageStats[b.path]?.count || 0
          return bUsage - aUsage
        default:
          return 0
      }
    })

  const categoryCounts = categories.reduce((acc, cat) => {
    acc[cat] = cat === 'all' ? skills.length : skills.filter((s) => s.category === cat).length
    return acc
  }, {} as Record<string, number>)

  // Compare view
  if (compareMode && compareList.length > 0) {
    const compareSkills = skills.filter((s) => compareList.includes(s.path))
    return (
      <div className="p-8 animate-fade-in">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">🔍 스킬 비교</h1>
            <p className="text-gray-400">{compareSkills.length}개 스킬 비교 중</p>
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
          {compareSkills.map((skill) => {
            const trans = getTranslation(skill.path)
            const displayName = language === 'ko' && trans?.title ? trans.title : skill.name
            const displayDesc = language === 'ko' && trans?.description ? trans.description : skill.description
            const displayContent = language === 'ko' && trans?.content ? trans.content : skill.content

            return (
              <div key={skill.path} className="glass rounded-xl overflow-hidden flex flex-col max-h-[800px]">
                <div className="p-4 border-b border-white/10 flex-shrink-0">
                  <h3 className="text-lg font-semibold mb-2">{displayName}</h3>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="px-2 py-1 bg-white/5 rounded">{skill.category}</span>
                    <span>{(skill.size / 1024).toFixed(1)} KB</span>
                  </div>
                  {displayDesc && (
                    <p className="text-sm text-gray-400 mt-2 line-clamp-2">{displayDesc}</p>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <MarkdownViewer content={displayContent} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Relation graph view
  if (showRelationGraph) {
    const nodes = skills.filter((s) => s.dependencies.length > 0 || s.relatedSkills.length > 0)
    return (
      <div className="p-8 animate-fade-in">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">🔗 스킬 관계도</h1>
            <p className="text-gray-400">{nodes.length}개 스킬에 관계 정의됨</p>
          </div>
          <button
            onClick={() => setShowRelationGraph(false)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
          >
            ← 목록으로
          </button>
        </div>

        <div className="glass rounded-xl p-6">
          <div className="space-y-4">
            {nodes.map((skill) => {
              const trans = getTranslation(skill.path)
              const displayName = language === 'ko' && trans?.title ? trans.title : skill.name

              return (
                <div key={skill.path} className="border-b border-white/5 pb-4 last:border-0">
                  <h3 className="text-lg font-semibold mb-2">{displayName}</h3>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {skill.dependencies.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">의존:</span>
                        {skill.dependencies.map((dep) => (
                          <span key={dep} className="px-2 py-1 bg-red-600/20 text-red-400 rounded">
                            {dep}
                          </span>
                        ))}
                      </div>
                    )}
                    {skill.relatedSkills.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">관련:</span>
                        {skill.relatedSkills.map((rel) => (
                          <span key={rel} className="px-2 py-1 bg-blue-600/20 text-blue-400 rounded">
                            {rel}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Full-screen skill view
  if (selectedSkill) {
    const customTagsForSkill = getCustomTagsForSkill(selectedSkill.path)
    const trans = getTranslation(selectedSkill.path)
    
    const displayName = language === 'ko' && trans?.title ? trans.title : selectedSkill.name
    const displayDesc = language === 'ko' && trans?.description ? trans.description : selectedSkill.description
    const displayContent = language === 'ko' && trans?.content ? trans.content : selectedSkill.content
    const translationIsStale = Boolean(trans?.sourceHash && trans.sourceHash !== selectedSkill.hash)

    return (
      <div className="h-full flex flex-col animate-fade-in">
        {/* Header */}
        <div className="glass-strong border-b border-white/10 px-8 py-6 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => {
                setSelectedSkill(null)
                setEditTranslation(false)
              }}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
            >
              ← 뒤로
            </button>
            <div className="flex items-center gap-3">
              {/* Language Toggle */}
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                <button
                  onClick={() => setLanguage('en')}
                  className={`px-3 py-1 text-sm transition-all ${
                    language === 'en' ? 'bg-white/10 text-white' : 'bg-white/5 text-gray-400'
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => setLanguage('ko')}
                  className={`px-3 py-1 text-sm transition-all ${
                    language === 'ko' ? 'bg-white/10 text-white' : 'bg-white/5 text-gray-400'
                  }`}
                >
                  한글
                </button>
              </div>
              {language === 'ko' && (
                <button
                  onClick={() => {
                    if (editTranslation) {
                      saveEditTranslation()
                    } else {
                      startEditTranslation(selectedSkill)
                    }
                  }}
                  className={`px-3 py-1 rounded-lg text-sm transition-all ${
                    editTranslation
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {editTranslation ? '💾 저장' : '✏️ 번역 편집'}
                </button>
              )}
              <button
                onClick={() => toggleFavorite(selectedSkill.path)}
                className={`px-3 py-1 rounded-lg text-sm transition-all ${
                  favorites.includes(selectedSkill.path)
                    ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                {favorites.includes(selectedSkill.path) ? '★ 즐겨찾기' : '☆ 즐겨찾기'}
              </button>
              <button
                onClick={() => setShowGuide(!showGuide)}
                className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-all"
              >
                📖 가이드
              </button>
              <span className="px-3 py-1 bg-white/10 rounded text-sm text-gray-300">
                {selectedSkill.category}
              </span>
              <span className="text-xs text-gray-500">
                {(selectedSkill.size / 1024).toFixed(1)} KB
              </span>
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">{displayName}</h1>
          {displayDesc && (
            <p className="text-gray-400">{displayDesc}</p>
          )}
          {language === 'ko' && translationIsStale && (
            <div className="mt-3 rounded-lg border border-yellow-600/30 bg-yellow-600/10 px-3 py-2 text-sm text-yellow-200">
              원문이 변경된 뒤의 번역입니다. 화면에서 참고용으로 읽고, 필요하면 번역을 다시 저장하세요.
            </div>
          )}
          {selectedSkill.trigger && (
            <div className="mt-2 p-3 bg-blue-600/10 border border-blue-600/30 rounded-lg">
              <span className="text-xs text-blue-400 font-semibold">트리거:</span>
              <p className="text-sm text-blue-300 mt-1">{selectedSkill.trigger}</p>
            </div>
          )}
          <div className="flex gap-4 text-xs text-gray-500 mt-3">
            <span>수정: {new Date(selectedSkill.modifiedAt).toLocaleString('ko-KR')}</span>
            <span>경로: {selectedSkill.fileName}</span>
            {usageStats[selectedSkill.path] && (
              <span>사용: {usageStats[selectedSkill.path].count}회</span>
            )}
          </div>
          {selectedSkill.tags.length > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {selectedSkill.tags.map((tag) => (
                <span key={tag} className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400">
                  #{tag}
                </span>
              ))}
            </div>
          )}
          {/* Custom Tags */}
          <div className="mt-3">
            <div className="flex gap-2 flex-wrap items-center">
              {customTagsForSkill.map((tag) => (
                <span key={tag} className="px-2 py-1 bg-purple-600/20 text-purple-400 rounded text-xs flex items-center gap-1">
                  #{tag}
                  <button
                    onClick={() => removeCustomTag(selectedSkill.path, tag)}
                    className="text-purple-400 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    addCustomTag(selectedSkill.path, (e.target as HTMLInputElement).value.trim())
                    ;(e.target as HTMLInputElement).value = ''
                  }
                }}
                className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-white/20 w-24"
                placeholder="+ 태그"
              />
            </div>
          </div>
          {/* Dependencies & Related */}
          {(selectedSkill.dependencies.length > 0 || selectedSkill.relatedSkills.length > 0) && (
            <div className="mt-3 flex gap-4 text-xs">
              {selectedSkill.dependencies.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">의존:</span>
                  {selectedSkill.dependencies.map((dep) => (
                    <span key={dep} className="px-2 py-1 bg-red-600/20 text-red-400 rounded">
                      {dep}
                    </span>
                  ))}
                </div>
              )}
              {selectedSkill.relatedSkills.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">관련:</span>
                  {selectedSkill.relatedSkills.map((rel) => (
                    <span key={rel} className="px-2 py-1 bg-blue-600/20 text-blue-400 rounded">
                      {rel}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-4xl mx-auto">
            {editTranslation ? (
              <div className="glass rounded-xl p-6">
                <h2 className="text-2xl font-bold mb-4">✏️ 번역 편집</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-400 mb-2">제목</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
                      placeholder="한글 제목"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-400 mb-2">설명</label>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20 h-20 resize-none"
                      placeholder="한글 설명"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-400 mb-2">내용 (마크다운)</label>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20 h-96 resize-none font-mono text-sm"
                      placeholder="한글 번역 내용 (마크다운 형식)"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveEditTranslation}
                      className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium transition-all"
                    >
                      💾 저장
                    </button>
                    <button
                      onClick={() => setEditTranslation(false)}
                      className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
                    >
                      취소
                    </button>
                  </div>
                </div>
              </div>
            ) : showGuide ? (
              <div className="glass rounded-xl p-6">
                <h2 className="text-2xl font-bold mb-4">📖 사용 가이드</h2>
                <div className="space-y-4 text-gray-300">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">이 스킬은 언제 사용하나요?</h3>
                    <p className="text-sm text-gray-400">
                      {selectedSkill.trigger || '특정 작업이나 상황에서 자동으로 제안됩니다.'}
                    </p>
                  </div>
                  {selectedSkill.dependencies.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-2">사전 요구사항</h3>
                      <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                        {selectedSkill.dependencies.map((dep) => (
                          <li key={dep}>{dep}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selectedSkill.relatedSkills.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-2">관련 스킬</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedSkill.relatedSkills.map((rel) => (
                          <span key={rel} className="px-3 py-1 bg-blue-600/20 text-blue-400 rounded">
                            {rel}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold mb-2">상세 내용</h3>
                    <MarkdownViewer content={displayContent} />
                  </div>
                </div>
              </div>
            ) : (
              <MarkdownViewer content={displayContent} />
            )}
          </div>
        </div>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">스킬 로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">🎯 스킬 라이브러리</h1>
          <p className="text-gray-400">{skills.length}개 스킬 · {categories.length - 1}개 카테고리 · {skillRoot}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowRelationGraph(true)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
          >
            🔗 관계도
          </button>
          {compareList.length > 0 && (
            <button
              onClick={() => setCompareMode(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-all"
            >
              🔍 비교 ({compareList.length})
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="glass rounded-xl p-4 mb-6">
        <div className="flex gap-4 items-center flex-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-[200px] bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
            placeholder="스킬 이름, 설명, 태그로 검색..."
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortType)}
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-white/20"
          >
            <option value="category">카테고리순</option>
            <option value="name">이름순</option>
            <option value="modified">최근 수정</option>
            <option value="size">크기순</option>
            <option value="usage">사용 빈도</option>
          </select>
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`px-4 py-2 rounded-lg transition-all ${
              showFavoritesOnly
                ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/50'
                : 'bg-white/5 hover:bg-white/10'
            }`}
          >
            {showFavoritesOnly ? '★ 즐겨찾기만' : '☆ 즐겨찾기'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-2 rounded-lg transition-all ${
                viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              ⊞
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 rounded-lg transition-all ${
                viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              ☰
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Categories */}
        <div className="lg:col-span-1">
          <div className="glass rounded-xl p-4 sticky top-8">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">카테고리</h3>
            <div className="space-y-1 max-h-[300px] overflow-y-auto mb-4">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${
                    selectedCategory === cat
                      ? 'bg-white/10 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>{cat === 'all' ? '전체' : cat}</span>
                  <span className="text-xs text-gray-500">{categoryCounts[cat]}</span>
                </button>
              ))}
            </div>

            {allTags.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-gray-400 mb-3 mt-4">태그</h3>
                <div className="flex flex-wrap gap-2 max-h-[200px] overflow-y-auto">
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSelectedTags(
                          selectedTags.includes(tag)
                            ? selectedTags.filter((t) => t !== tag)
                            : [...selectedTags, tag]
                        )
                      }}
                      className={`px-2 py-1 rounded text-xs transition-all ${
                        selectedTags.includes(tag)
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-600/50'
                          : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
                {selectedTags.length > 0 && (
                  <button
                    onClick={() => setSelectedTags([])}
                    className="mt-2 text-xs text-gray-500 hover:text-white"
                  >
                    태그 필터 초기화
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3">
          <div className="mb-4 text-sm text-gray-400">
            {filteredSkills.length}개 스킬 표시
          </div>

          {filteredSkills.length === 0 ? (
            <div className="glass rounded-xl p-12 text-center text-gray-500">
              검색 결과가 없습니다
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredSkills.map((skill) => {
                const trans = getTranslation(skill.path)
                const displayName = language === 'ko' && trans?.title ? trans.title : skill.name
                const displayDesc = language === 'ko' && trans?.description ? trans.description : skill.description

                return (
                  <div
                    key={skill.path}
                    className="glass rounded-xl p-6 hover:border-white/20 transition-all hover:scale-105 relative"
                  >
                    {favorites.includes(skill.path) && (
                      <span className="absolute top-3 right-3 text-yellow-400">★</span>
                    )}
                    {language === 'ko' && trans && (
                      <span className="absolute top-3 left-3 px-2 py-0.5 bg-blue-600/20 text-blue-400 rounded text-xs">
                        번역됨
                      </span>
                    )}
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-lg font-semibold pr-6">{displayName}</h3>
                      <input
                        type="checkbox"
                        checked={compareList.includes(skill.path)}
                        onChange={() => toggleCompare(skill.path)}
                        className="w-4 h-4"
                        title="비교에 추가"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                      <span className="px-2 py-1 bg-white/5 rounded">{skill.category}</span>
                      <span>{(skill.size / 1024).toFixed(1)} KB</span>
                      {usageStats[skill.path] && (
                        <span>· {usageStats[skill.path].count}회</span>
                      )}
                    </div>
                    {displayDesc && (
                      <p className="text-sm text-gray-400 line-clamp-2">{displayDesc}</p>
                    )}
                    {skill.tags.length > 0 && (
                      <div className="flex gap-1 mt-3 flex-wrap">
                        {skill.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="px-2 py-0.5 bg-white/5 rounded text-xs text-gray-500">
                            #{tag}
                          </span>
                        ))}
                        {skill.tags.length > 3 && (
                          <span className="text-xs text-gray-500">+{skill.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => handleSkillClick(skill)}
                      className="mt-4 w-full px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all"
                    >
                      자세히 보기 →
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="glass rounded-xl overflow-hidden">
              <div className="divide-y divide-white/5">
                {filteredSkills.map((skill) => {
                  const trans = getTranslation(skill.path)
                  const displayName = language === 'ko' && trans?.title ? trans.title : skill.name
                  const displayDesc = language === 'ko' && trans?.description ? trans.description : skill.description

                  return (
                    <div
                      key={skill.path}
                      className="p-4 hover:bg-white/5 transition-all"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {favorites.includes(skill.path) && (
                              <span className="text-yellow-400 text-sm">★</span>
                            )}
                            {language === 'ko' && trans && (
                              <span className="px-2 py-0.5 bg-blue-600/20 text-blue-400 rounded text-xs">
                                번역됨
                              </span>
                            )}
                            <h3 className="font-semibold">{displayName}</h3>
                            <input
                              type="checkbox"
                              checked={compareList.includes(skill.path)}
                              onChange={() => toggleCompare(skill.path)}
                              className="w-4 h-4 ml-auto"
                              title="비교에 추가"
                            />
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                            <span className="px-2 py-1 bg-white/5 rounded">{skill.category}</span>
                            <span>{(skill.size / 1024).toFixed(1)} KB</span>
                            <span>{new Date(skill.modifiedAt).toLocaleDateString('ko-KR')}</span>
                            {usageStats[skill.path] && (
                              <span>· {usageStats[skill.path].count}회</span>
                            )}
                          </div>
                          {displayDesc && (
                            <p className="text-sm text-gray-400 mt-2 line-clamp-1">{displayDesc}</p>
                          )}
                          {skill.tags.length > 0 && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {skill.tags.slice(0, 5).map((tag) => (
                                <span key={tag} className="px-2 py-0.5 bg-white/5 rounded text-xs text-gray-500">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <button
                            onClick={() => handleSkillClick(skill)}
                            className="mt-2 text-sm text-blue-400 hover:text-blue-300"
                          >
                            자세히 보기 →
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
