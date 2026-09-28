import fs from 'fs'
import path from 'path'

const ENV_FILE = /^\.env(\..+)?$/
const SKIP_ENV = /\.(example|sample|template|dist|defaults?)$/i
const LINE = /^((?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)(.*)$/

export interface EnvWrite {
  ok: boolean
  message: string
  /** True when the file bytes changed. */
  changed: boolean
  backup: string
}

/**
 * Replace one variable, keeping quotes and the rest of the file.
 * Refuses when the current value is not the one DIOS stored, so a hand edit is not overwritten.
 */
export function replaceEnvValue(text: string, name: string, oldValue: string, newValue: string): { ok: boolean; message: string; text: string } {
  if (!name || !oldValue || !newValue) return { ok: false, message: '바꿀 값이 비어 있어요.', text }
  if (oldValue === newValue) return { ok: true, message: '', text }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let found = false
  let changed = false
  const next = lines.map((line) => {
    if (found) return line
    const match = line.match(LINE)
    if (!match || match[1].replace(/^export\s+/, '') !== name) return line
    found = true
    const written = swapValue(match[3], oldValue, newValue)
    if (!written.ok) return line
    changed = written.changed
    return `${match[1]}${match[2]}${written.value}`
  })
  if (!found) return { ok: false, message: '설정 파일에 그 항목이 없어서 파일은 그대로 뒀어요.', text }
  if (!changed && oldValue !== newValue) return { ok: false, message: '설정 파일이 이미 바뀌어서 파일은 그대로 뒀어요.', text }
  const joined = next.join(newline)
  return { ok: true, message: '', text: text.endsWith('\n') || text.endsWith('\r\n') ? (joined.endsWith(newline) ? joined : joined + newline) : joined }
}

/**
 * Write one key back into the .env it was found in, after keeping a single backup beside it.
 * Only real env files are touched.
 */
export function writeEnvKey(file: string, name: string, oldValue: string, newValue: string): EnvWrite {
  const resolved = path.resolve(file)
  const base = path.basename(resolved)
  if (!ENV_FILE.test(base) || SKIP_ENV.test(base)) {
    return { ok: false, message: '그 파일은 설정 파일이 아니라서 건드리지 않았어요.', changed: false, backup: '' }
  }
  let current = ''
  try {
    current = fs.readFileSync(resolved, 'utf8')
  } catch {
    return { ok: false, message: '설정 파일을 열지 못해서 파일은 그대로 뒀어요.', changed: false, backup: '' }
  }
  const replaced = replaceEnvValue(current, name, oldValue, newValue)
  if (!replaced.ok) return { ok: false, message: replaced.message, changed: false, backup: '' }
  if (replaced.text === current) return { ok: true, message: '', changed: false, backup: '' }
  const backup = `${resolved}.dios-백업`
  try {
    fs.copyFileSync(resolved, backup)
    const tmp = `${resolved}.dios-tmp`
    fs.writeFileSync(tmp, replaced.text)
    fs.renameSync(tmp, resolved)
  } catch {
    return { ok: false, message: '설정 파일을 저장하지 못했어요. DIOS 안의 키는 바뀌어 있어요.', changed: false, backup: '' }
  }
  return { ok: true, message: '프로젝트 설정도 같이 고쳤어요.', changed: true, backup }
}

/** Put the backup back over the env file. */
export function restoreEnvBackup(file: string, backup: string): boolean {
  try {
    if (!backup || !fs.existsSync(backup)) return false
    fs.copyFileSync(backup, path.resolve(file))
    return true
  } catch {
    return false
  }
}

function swapValue(raw: string, oldValue: string, newValue: string): { ok: boolean; changed: boolean; value: string } {
  const trimmed = raw.trim()
  const quoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  const current = quoted ? trimmed.slice(1, -1) : stripComment(trimmed)
  if (current !== oldValue) return { ok: false, changed: false, value: raw }
  if (quoted) {
    const quote = trimmed[0]
    return { ok: true, changed: true, value: `${quote}${newValue}${quote}` }
  }
  const commentAt = trimmed.indexOf(' #')
  const comment = commentAt >= 0 ? trimmed.slice(commentAt) : ''
  return { ok: true, changed: true, value: `${newValue}${comment}` }
}

function stripComment(value: string): string {
  const commentAt = value.indexOf(' #')
  return (commentAt >= 0 ? value.slice(0, commentAt) : value).trim()
}
