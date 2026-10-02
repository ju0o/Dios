import fs from 'fs'
import path from 'path'
import { OTHER_PLATFORM } from './api-key-text'

/** One key found in a project folder, before it is registered. */
export interface EnvFinding {
  project: string
  platform: string
  /** The variable name, kept as the key's label so two keys in one file stay apart. */
  label: string
  key: string
  /** The .env file it came from. Shown only under 원문 보기. */
  source: string
  /** The scan root this file was found under, so the screen can say which folder produced it. */
  root: string
}

/** What happened in one scan root. The Founder sees one row per root. */
export interface RootReport {
  root: string
  /** False when the folder is gone (moved, renamed, or on a drive that is not plugged in). */
  exists: boolean
  /** .env files read under this root. */
  files: number
  /** Keys that looked like API keys, before dedupe against the store. */
  found: number
  /** True when the walk hit the file ceiling, so some .env files were not read. */
  truncated: boolean
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', 'target', '.cache', 'coverage', '.idea', '.vscode'])
const SKIP_ENV = /\.(example|sample|template|dist|defaults?)$/i
const ENV_FILE = /^\.env(\..+)?$/
/** Deep enough for ~/Projects/<group>/<project>/<apps>/<web>/.env. */
export const MAX_DEPTH = 5
export const MAX_FILES = 600
const PLACEHOLDER = /^(your[-_ ]?|<|xxx|changeme|replace|sk-\.\.\.|\.\.\.|todo|none|null|\$\{)/i

/** Variable name patterns, most specific first. */
const BY_NAME: Array<[RegExp, string]> = [
  [/^OPENAI_/, 'OpenAI'],
  [/^ANTHROPIC_|^CLAUDE_/, 'Anthropic (Claude)'],
  [/^GEMINI_|^GOOGLE_(API|GENAI|GENERATIVE|AI)/, 'Google (Gemini)'],
  [/^OPENROUTER_/, 'OpenRouter'],
  [/^XAI_|^GROK_/, 'xAI (Grok)'],
  [/^CURSOR_/, 'Cursor'],
  [/^GITHUB_|^GH_TOKEN$|^GH_PAT/, 'GitHub'],
  [/^SUPABASE_/, 'Supabase'],
  [/^FIREBASE_|^FB_API/, 'Firebase'],
  [/^AWS_/, 'AWS'],
  [/^VERCEL_/, 'Vercel'],
  [/^NOTION_/, 'Notion'],
  [/^SLACK_/, 'Slack'],
  [/^TELEGRAM_|^TG_BOT/, 'Telegram'],
  [/^DISCORD_/, 'Discord'],
  [/^STRIPE_/, 'Stripe'],
  [/^TOSS_/, 'Toss Payments'],
  [/^KAKAO_/, 'Kakao'],
  [/^NAVER_/, 'Naver'],
  [/^HF_|^HUGGINGFACE_|^HUGGING_FACE_/, 'Hugging Face'],
  [/^REPLICATE_/, 'Replicate'],
  [/^ELEVENLABS_|^ELEVEN_/, 'ElevenLabs'],
  [/^DEEPGRAM_/, 'Deepgram'],
  [/^MISTRAL_/, 'Mistral'],
  [/^GROQ_/, 'Groq'],
  [/^DEEPSEEK_/, 'DeepSeek'],
  [/^PERPLEXITY_/, 'Perplexity'],
  [/^TAVILY_/, 'Tavily'],
  [/^SERPAPI_|^SERP_/, 'SerpAPI'],
  [/^SENDGRID_/, 'SendGrid'],
  [/^TWILIO_/, 'Twilio'],
  [/^CLOUDFLARE_|^CF_API/, 'Cloudflare'],
  [/^SENTRY_/, 'Sentry'],
  [/^YOUTUBE_/, 'YouTube'],
]

/** Value shapes for keys whose variable name says nothing. */
const BY_VALUE: Array<[RegExp, string]> = [
  [/^sk-ant-/, 'Anthropic (Claude)'],
  [/^sk-or-/, 'OpenRouter'],
  [/^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/, 'OpenAI'],
  [/^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$|^github_pat_/, 'GitHub'],
  [/^AIza[0-9A-Za-z_-]{30,}$/, 'Google (Gemini)'],
  [/^xai-[A-Za-z0-9]{20,}$/, 'xAI (Grok)'],
  [/^xox[abprs]-/, 'Slack'],
  [/^\d{8,10}:[A-Za-z0-9_-]{30,}$/, 'Telegram'],
  [/^AKIA[0-9A-Z]{16}$/, 'AWS'],
  [/^hf_[A-Za-z0-9]{20,}$/, 'Hugging Face'],
  [/^r8_[A-Za-z0-9]{20,}$/, 'Replicate'],
  [/^sk_(live|test)_/, 'Stripe'],
  [/^gsk_[A-Za-z0-9]{20,}$/, 'Groq'],
  [/^pplx-/, 'Perplexity'],
  [/^tvly-/, 'Tavily'],
]

/** Variable names that hold a secret rather than an address, a model name, or a flag. */
const SECRET_NAME = /(API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|CLIENT[_-]?SECRET|SERVICE[_-]?ROLE|_KEY)$/i
const NOT_SECRET = /(URL|URI|HOST|ENDPOINT|BASE|MODEL|REGION|BUCKET|PROJECT[_-]?ID|CLIENT[_-]?ID|APP[_-]?ID|PUBLIC|ANON|ID|PORT|NAME|PATH|DIR|MODE|ENV|DEBUG|ENABLED|VERSION|ORG|TEAM)$/i

/** Platform for one variable, or empty when the value is not a key. */
export function platformFor(name: string, value: string): string {
  const upper = name.toUpperCase()
  if (!value || value.length < 8 || PLACEHOLDER.test(value)) return ''
  if (/\s/.test(value)) return ''
  const byValue = BY_VALUE.find(([pattern]) => pattern.test(value))
  if (byValue) return byValue[1]
  if (!SECRET_NAME.test(upper) || NOT_SECRET.test(upper)) return ''
  const byName = BY_NAME.find(([pattern]) => pattern.test(upper))
  if (byName) return byName[1]
  const prefix = upper.split('_')[0]
  if (prefix && prefix.length >= 3 && !/^(API|APP|MY|THE|DEV|PROD|TEST|LOCAL|SERVER|CLIENT|SECRET|ACCESS|AUTH|JWT|SESSION|DB|DATABASE|REDIS|SMTP|MAIL|NEXT|VITE|REACT|PUBLIC|PRIVATE)$/.test(prefix)) {
    return titleCase(prefix)
  }
  return ''
}

/** KEY=VALUE lines from a dotenv file. Quotes and `export` are removed. Comments are skipped. */
export function parseEnv(text: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
    }
    out.push({ name: match[1], value })
  }
  return out
}

/**
 * Keys found under the given folders. Each finding says which project folder and which
 * scan root it belongs to, and `roots` reports every root — including ones that no longer exist —
 * so the screen can show exactly where DIOS looked.
 */
export function scanEnvRoots(roots: string[]): { findings: EnvFinding[]; files: number; folders: number; roots: RootReport[] } {
  const findings: EnvFinding[] = []
  const reports: RootReport[] = []
  let files = 0
  let folders = 0
  const seen = new Set<string>()
  for (const root of roots) {
    let real: string
    try {
      real = fs.realpathSync(root)
    } catch {
      reports.push({ root, exists: false, files: 0, found: 0, truncated: false })
      continue
    }
    if (seen.has(real)) continue
    seen.add(real)
    folders += 1
    const envFiles: string[] = []
    const walked = { truncated: false }
    walk(real, 0, envFiles, walked)
    let rootFiles = 0
    let rootFound = 0
    for (const file of envFiles) {
      if (files >= MAX_FILES) {
        walked.truncated = true
        break
      }
      files += 1
      rootFiles += 1
      const project = projectNameFor(real, file)
      let text = ''
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch {
        continue
      }
      for (const entry of parseEnv(text)) {
        const platform = platformFor(entry.name, entry.value)
        if (!platform) continue
        rootFound += 1
        findings.push({ project, platform, label: entry.name, key: entry.value, source: file, root })
      }
    }
    reports.push({ root, exists: true, files: rootFiles, found: rootFound, truncated: walked.truncated })
  }
  return { findings: dedupe(findings), files, folders, roots: reports }
}

/** Last folder name of a path, for messages that name a folder without the whole path. */
export function shortRoot(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

/**
 * One line after a scan. When only one or two folders were looked at, they are named,
 * so "폴더 1개를 훑었는데 없어요" never leaves the Founder guessing which one.
 */
export function scanMessage(folders: number, files: number, added: number, kept: number, found: number, roots: string[] = []): string {
  const named = roots.length > 0 && roots.length <= 2 ? `${roots.map((root) => `"${shortRoot(root)}"`).join('와 ')} 폴더` : `폴더 ${folders}개`
  if (!folders) return '훑을 프로젝트 폴더가 없어요. 아래에서 폴더를 골라 주세요.'
  if (!files) return `${named}를 훑었는데 설정 파일(.env)이 없어요.`
  if (!found) return `${named}, 설정 파일 ${files}개를 훑었는데 API 키로 보이는 값이 없어요.`
  const parts = [`${named}를 훑어서 키 ${found}개를 찾았어요.`]
  if (added) parts.push(`${added}개를 새로 등록했어요.`)
  if (kept) parts.push(`이미 있던 ${kept}개는 그대로예요.`)
  return parts.join(' ')
}

/** Plain Korean for one root row. `added` is how many keys from this root were new in the store. */
export function rootLine(report: RootReport, added = 0): string {
  if (!report.exists) return '이 폴더가 지금은 없어요. 옮겨졌거나 지워졌을 수 있어요.'
  if (!report.files) return '설정 파일(.env)이 없어요.'
  if (!report.found) return `설정 파일 ${report.files}개 · API 키로 보이는 값은 없어요.`
  const parts = [`설정 파일 ${report.files}개 · 키 ${report.found}개`]
  if (added) parts.push(`새로 ${added}개`)
  if (report.truncated) parts.push('너무 깊거나 많아서 일부는 건너뛰었어요')
  return parts.join(' · ')
}

/** Folders that usually hold projects. Only those that exist are returned. */
export function defaultScanRoots(home: string): string[] {
  const candidates = ['src', 'Projects', 'projects', 'dev', 'code', 'work', path.join('Desktop', 'Projects'), path.join('Documents', 'Projects')]
  return candidates.map((rel) => path.join(home, rel)).filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

function walk(dir: string, depth: number, out: string[], state: { truncated: boolean }): void {
  if (depth > MAX_DEPTH) return
  if (out.length >= MAX_FILES) {
    state.truncated = true
    return
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) {
      state.truncated = true
      return
    }
    if (entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.config')) continue
      walk(full, depth + 1, out, state)
      continue
    }
    if (entry.isFile() && ENV_FILE.test(entry.name) && !SKIP_ENV.test(entry.name)) out.push(full)
  }
}

/** Nearest folder that looks like a project; otherwise the first folder under the root, or the root itself. */
function projectNameFor(root: string, file: string): string {
  let dir = path.dirname(file)
  if (dir === root) return path.basename(root)
  let topChild = dir
  while (dir.length > root.length) {
    if (looksLikeProject(dir)) return path.basename(dir)
    const parent = path.dirname(dir)
    if (parent === dir) break
    if (parent === root) topChild = dir
    dir = parent
  }
  return path.basename(topChild)
}

function looksLikeProject(dir: string): boolean {
  return ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', '.git', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile'].some((marker) => {
    try {
      return fs.existsSync(path.join(dir, marker))
    } catch {
      return false
    }
  })
}

function dedupe(findings: EnvFinding[]): EnvFinding[] {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const id = `${finding.project}\n${finding.platform}\n${finding.label}\n${finding.key}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function titleCase(word: string): string {
  const lower = word.toLowerCase()
  const name = lower.charAt(0).toUpperCase() + lower.slice(1)
  return name === 'Other' ? OTHER_PLATFORM : name
}
