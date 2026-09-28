import type { SkillFile, SkillPack } from '../skill-board/library'
import { frontmatter } from './catalog'
import { skillStory } from '../skill-board/model'

/** Where a pasted address points. */
export interface SkillSource {
  kind: 'github' | 'raw'
  owner: string
  repo: string
  ref: string
  /** Folder inside the repo, '' for the root. */
  dir: string
  /** The address as the Founder pasted it, cleaned. */
  url: string
}

/** One skill the address turned out to hold, ready to be written. */
export interface SkillCandidate {
  name: string
  summary: string
  files: SkillFile[]
  source: string
}

export interface FetchOutcome {
  ok: boolean
  message: string
  candidates: SkillCandidate[]
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/
const MAX_FILES = 40
const MAX_FILE = 256_000
const TEXT_EXT = /\.(md|txt|json|ya?ml|py|sh|ps1|js|mjs|cjs|ts|tsx|jsx|toml|ini|cfg|csv|html|css|xml|mdc|bat|cmd)$/i
/** Folders that commonly hold many skills inside one repository. */
const SKILL_FOLDERS = ['skills', '.agents/skills', '.claude/skills', '.cursor/skills', '.codex/skills']

/**
 * Understand what the Founder pasted: a GitHub page, a raw file address, or the short
 * "owner/repo" or "owner/repo/skill-name" form.
 */
export function parseSkillSource(input: string): SkillSource | null {
  const text = input.trim().replace(/\s+/g, '')
  if (!text) return null
  if (!/^https?:\/\//i.test(text)) {
    if (/^(www\.)?(github\.com|raw\.githubusercontent\.com)\//i.test(text)) return parseSkillSource(`https://${text}`)
    // "owner/repo" or "owner/repo/skill-name", the way skill sites print it.
    const short = text.replace(/^@/, '').split('/').filter(Boolean)
    if (short.length >= 2 && short.length <= 3 && short.every((part) => /^[\w.-]+$/.test(part))) {
      const repo = short[1].replace(/\.git$/, '')
      return { kind: 'github', owner: short[0], repo, ref: '', dir: short[2] ? `skills/${short[2]}` : '', url: `https://github.com/${short[0]}/${repo}` }
    }
    return null
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  const host = url.hostname.toLowerCase()
  if (host === 'raw.githubusercontent.com' && parts.length >= 3) {
    const [owner, repo, ref, ...rest] = parts
    const dir = rest.length && /\.md$/i.test(rest[rest.length - 1]) ? rest.slice(0, -1) : rest
    return { kind: 'github', owner, repo, ref, dir: dir.join('/'), url: text }
  }
  if (host === 'github.com' || host === 'www.github.com') {
    if (parts.length < 2) return null
    const [owner, rawRepo, mode, ref, ...rest] = parts
    const repo = rawRepo.replace(/\.git$/, '')
    if ((mode === 'tree' || mode === 'blob') && ref) {
      const dir = mode === 'blob' && rest.length ? rest.slice(0, -1) : rest
      return { kind: 'github', owner, repo, ref, dir: dir.join('/'), url: text }
    }
    return { kind: 'github', owner, repo, ref: '', dir: '', url: text }
  }
  if (/\.md$/i.test(url.pathname)) return { kind: 'raw', owner: '', repo: '', ref: '', dir: '', url: text }
  return null
}

/**
 * Download the skill(s) behind an address. Public GitHub needs no login.
 * A repository with a skills folder gives several candidates; the Founder picks.
 */
export async function fetchSkillCandidates(input: string, fetcher: Fetcher = defaultFetcher): Promise<FetchOutcome> {
  const source = parseSkillSource(input)
  if (!source) return { ok: false, message: 'GitHub 주소나 SKILL.md 파일 주소를 붙여 넣어 주세요. 예: github.com/이름/저장소', candidates: [] }
  try {
    if (source.kind === 'raw') {
      const text = await getText(fetcher, source.url)
      const candidate = candidateFromFiles(nameFromUrl(source.url), [{ path: 'SKILL.md', text }], source.url)
      return candidate ? { ok: true, message: '', candidates: [candidate] } : { ok: false, message: '그 파일은 스킬 글이 아니에요. 맨 위에 name: 줄이 있어야 해요.', candidates: [] }
    }
    const listing = await listGithub(fetcher, source, source.dir)
    if (listing === null) return { ok: false, message: '그 주소를 못 찾았어요. 공개 저장소인지, 주소가 맞는지 봐 주세요.', candidates: [] }
    if (listing.some((item) => item.type === 'file' && item.name === 'SKILL.md')) {
      const files = await collectFiles(fetcher, source, listing)
      const candidate = candidateFromFiles(source.dir.split('/').pop() || source.repo, files, source.url)
      return candidate ? { ok: true, message: '', candidates: [candidate] } : { ok: false, message: '스킬 글의 이름 줄을 읽지 못했어요.', candidates: [] }
    }
    // No SKILL.md here: look one level down, and in the usual skills folders.
    const folders = listing.filter((item) => item.type === 'dir').map((item) => item.path)
    const known = SKILL_FOLDERS.map((folder) => (source.dir ? `${source.dir}/${folder}` : folder))
    const candidates: SkillCandidate[] = []
    const seen = new Set<string>()
    const tryFolder = async (folder: string) => {
      const inner = await listGithub(fetcher, source, folder)
      if (!inner) return
      if (inner.some((item) => item.type === 'file' && item.name === 'SKILL.md')) {
        const files = await collectFiles(fetcher, source, inner)
        const candidate = candidateFromFiles(folder.split('/').pop() || '', files, `${source.url.replace(/\/$/, '')}`)
        if (candidate && !seen.has(candidate.name)) {
          seen.add(candidate.name)
          candidates.push(candidate)
        }
        return
      }
      for (const sub of inner.filter((item) => item.type === 'dir').slice(0, 60)) {
        const deeper = await listGithub(fetcher, source, sub.path)
        if (!deeper?.some((item) => item.type === 'file' && item.name === 'SKILL.md')) continue
        const files = await collectFiles(fetcher, source, deeper)
        const candidate = candidateFromFiles(sub.name, files, source.url)
        if (candidate && !seen.has(candidate.name)) {
          seen.add(candidate.name)
          candidates.push(candidate)
        }
      }
    }
    for (const folder of known.filter((folder) => folders.includes(folder) || listing.some((item) => item.path === folder))) await tryFolder(folder)
    if (!candidates.length) for (const folder of folders.slice(0, 40)) await tryFolder(folder)
    if (!candidates.length) return { ok: false, message: '그 주소 안에서 스킬(SKILL.md가 있는 폴더)을 못 찾았어요.', candidates: [] }
    candidates.sort((left, right) => left.name.localeCompare(right.name))
    return { ok: true, message: candidates.length > 1 ? `스킬 ${candidates.length}개를 찾았어요. 받을 것을 골라 주세요.` : '', candidates }
  } catch (error) {
    return { ok: false, message: explain(error), candidates: [] }
  }
}

/** Turn downloaded files into a candidate, or null when SKILL.md has no usable name. */
export function candidateFromFiles(fallbackName: string, files: SkillFile[], source: string): SkillCandidate | null {
  const skill = files.find((file) => file.path === 'SKILL.md')
  if (!skill?.text.trim()) return null
  const front = frontmatter(skill.text)
  const name = (front.name || fallbackName).toLowerCase().trim()
  if (!SAFE_NAME.test(name)) return null
  return { name, summary: skillStory(skill.text).summary || front.description, files, source }
}

/** The pack the skill board's import expects. */
export function packOf(candidate: SkillCandidate): SkillPack {
  return { name: candidate.name, files: candidate.files }
}

interface GithubItem {
  name: string
  path: string
  type: 'file' | 'dir' | string
  size?: number
  download_url?: string | null
}

async function listGithub(fetcher: Fetcher, source: SkillSource, dir: string): Promise<GithubItem[] | null> {
  const api = `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${dir}${source.ref ? `?ref=${encodeURIComponent(source.ref)}` : ''}`
  const response = await fetcher(api)
  if (response.status === 404) return null
  if (response.status === 403 || response.status === 429) throw new Error('rate')
  if (!response.ok) throw new Error(`status ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body)) return null
  return body as GithubItem[]
}

async function collectFiles(fetcher: Fetcher, source: SkillSource, listing: GithubItem[]): Promise<SkillFile[]> {
  const files: SkillFile[] = []
  const walk = async (items: GithubItem[], prefix: string) => {
    for (const item of items) {
      if (files.length >= MAX_FILES) return
      const rel = prefix ? `${prefix}/${item.name}` : item.name
      if (item.type === 'dir') {
        const inner = await listGithub(fetcher, source, item.path)
        if (inner) await walk(inner, rel)
        continue
      }
      if (item.type !== 'file' || !item.download_url) continue
      if (!TEXT_EXT.test(item.name) && item.name !== 'SKILL.md') continue
      if ((item.size ?? 0) > MAX_FILE) continue
      files.push({ path: rel, text: await getText(fetcher, item.download_url) })
    }
  }
  await walk(listing, '')
  return files
}

async function getText(fetcher: Fetcher, url: string): Promise<string> {
  const response = await fetcher(url)
  if (response.status === 404) throw new Error('missing')
  if (response.status === 403 || response.status === 429) throw new Error('rate')
  if (!response.ok) throw new Error(`status ${response.status}`)
  const text = await response.text()
  return text.length > MAX_FILE ? text.slice(0, MAX_FILE) : text
}

function nameFromUrl(url: string): string {
  const parts = url.split('/').filter(Boolean)
  const file = parts[parts.length - 1] ?? ''
  const folder = parts[parts.length - 2] ?? ''
  return /^skill\.md$/i.test(file) ? folder : file.replace(/\.md$/i, '')
}

function explain(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text === 'rate') return 'GitHub가 잠시 요청을 막았어요. 몇 분 뒤에 다시 해 주세요.'
  if (text === 'missing') return '그 주소를 못 찾았어요. 공개 저장소인지, 주소가 맞는지 봐 주세요.'
  if (/ENOTFOUND|ECONN|fetch failed|network/i.test(text)) return '인터넷에 닿지 못했어요. 연결을 확인해 주세요.'
  return '내려받지 못했어요. 주소를 다시 확인해 주세요.'
}

async function defaultFetcher(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'DIOS-skill-library', Accept: 'application/vnd.github+json, text/plain;q=0.9, */*;q=0.8' }, signal: AbortSignal.timeout(20_000) })
  return { ok: response.ok, status: response.status, text: () => response.text(), json: () => response.json() as Promise<unknown> }
}
