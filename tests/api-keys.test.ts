import fs from 'fs'
import os from 'os'
import path from 'path'
import { checkInput, groupByProject, headline, maskSecret, usageLine } from '../src/core/api-keys/api-key-text'
import { parseEnv, platformFor, scanMessage } from '../src/core/api-keys/env-scan'
import { replaceEnvValue, writeEnvKey, restoreEnvBackup } from '../src/core/api-keys/env-write'
import { checkSummary, healthFromStatus, healthFromUsageError, healthLabel, probeKey, probeTarget } from '../src/core/api-keys/key-health'

describe('api key masking', () => {
  it('keeps only the prefix and the last four characters', () => {
    expect(maskSecret('sk-proj-abcdefghijklmnop1234')).toBe('sk-••••••••1234')
    expect(maskSecret('ghp_abcdefghijklmnopqrstuvwxyz')).toBe('ghp_••••••••wxyz')
    expect(maskSecret('AIzaSyD-abcdefghijklmnop')).toBe('••••••••mnop')
  })

  it('shows only dots for short keys and nothing for empty', () => {
    expect(maskSecret('abc123')).toBe('••••••••')
    expect(maskSecret('')).toBe('')
  })
})

describe('api key input', () => {
  it('asks for project, platform, and key in plain Korean', () => {
    expect(checkInput({}, false).message).toBe('어느 프로젝트에 쓰는 키인지 적어 주세요.')
    expect(checkInput({ project: 'Dios' }, false).message).toBe('어느 플랫폼의 키인지 골라 주세요.')
    expect(checkInput({ project: 'Dios', platform: 'OpenAI' }, false).message).toBe('API 키를 붙여 넣어 주세요.')
    expect(checkInput({ project: 'Dios', platform: 'OpenAI', key: 'sk 123' }, false).message).toContain('빈칸')
  })

  it('lets an edit keep the saved key when the field is blank', () => {
    const checked = checkInput({ project: ' Dios ', platform: 'OpenAI', key: '', note: 'a\r\nb' }, true)
    expect(checked.ok).toBe(true)
    expect(checked.value.project).toBe('Dios')
    expect(checked.value.note).toBe('a\nb')
  })
})

describe('api key screen text', () => {
  const base = { label: '', plain: false, note: '', source: '', serviceId: '', health: '', healthAt: 0, updatedAt: 1 }
  const cards = [
    { ...base, id: '1', project: 'JuPlan', platform: 'OpenAI', masked: '••••••••1234' },
    { ...base, id: '2', project: 'Dios', platform: 'GitHub', label: '시험용', masked: '••••••••wxyz' },
    { ...base, id: '3', project: 'Dios', platform: 'Anthropic (Claude)', masked: '••••••••abcd' },
  ]

  it('groups by project in name order', () => {
    const groups = groupByProject(cards)
    expect(groups.map((group) => group.project)).toEqual(['Dios', 'JuPlan'])
    expect(groups[0].cards.map((card) => card.platform)).toEqual(['Anthropic (Claude)', 'GitHub'])
  })

  it('sums the top line without secrets', () => {
    expect(headline(cards)).toBe('프로젝트 2개에 API 키 3개가 등록돼 있어요. 키는 이 컴퓨터 안에만 저장돼요.')
    expect(headline([])).toContain('아직 등록한 API 키가 없어요')
  })

  it('tells the usage in one Korean line', () => {
    expect(usageLine(undefined, false)).toBe('')
    expect(usageLine(undefined, true)).toContain('아직')
    expect(usageLine({ used: 12.34, limit: 50, percent: 25, currency: 'USD', status: 'success' }, true)).toBe('이번 달 12.34달러 / 50달러 (25%)')
    expect(usageLine({ used: 0, limit: 0, percent: 0, currency: 'USD', status: 'error', error: 'HTTP 401' }, true)).not.toContain('HTTP')
  })
})

describe('env scan', () => {
  it('reads dotenv lines with quotes, export, and comments', () => {
    const rows = parseEnv('# note\nexport OPENAI_API_KEY="sk-proj-abcdefghijklmnopqrstuvwxyz"\nPORT=3000 # local\n\nBAD LINE\n')
    expect(rows).toEqual([
      { name: 'OPENAI_API_KEY', value: 'sk-proj-abcdefghijklmnopqrstuvwxyz' },
      { name: 'PORT', value: '3000' },
    ])
  })

  it('names the platform from the value shape first, then the variable name', () => {
    expect(platformFor('MY_KEY', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe('Anthropic (Claude)')
    expect(platformFor('OPENROUTER_API_KEY', 'abcdefghijklmnop')).toBe('OpenRouter')
    expect(platformFor('GH_TOKEN', 'ghp_abcdefghijklmnopqrstuvwxyz1234')).toBe('GitHub')
    expect(platformFor('NAVER_CLIENT_SECRET', 'abcdefghijklmnop')).toBe('Naver')
    expect(platformFor('ACME_API_KEY', 'abcdefghijklmnop')).toBe('Acme')
  })

  it('leaves out addresses, ids, flags, and placeholders', () => {
    expect(platformFor('OPENAI_BASE_URL', 'https://api.openai.com/v1')).toBe('')
    expect(platformFor('SUPABASE_PROJECT_ID', 'abcdefghijklmnop')).toBe('')
    expect(platformFor('OPENAI_API_KEY', 'your-key-here')).toBe('')
    expect(platformFor('OPENAI_API_KEY', 'short')).toBe('')
    expect(platformFor('DEBUG', 'true')).toBe('')
  })

  it('sums the scan in plain Korean without paths', () => {
    expect(scanMessage(0, 0, 0, 0, 0)).toContain('폴더가 없어요')
    expect(scanMessage(2, 0, 0, 0, 0)).toContain('.env')
    expect(scanMessage(2, 3, 2, 1, 3)).toBe('폴더 2개를 훑어서 키 3개를 찾았어요. 2개를 새로 등록했어요. 이미 있던 1개는 그대로예요.')
  })
})

describe('key health', () => {
  it('reads a status as working, rejected, or over the limit', () => {
    expect(healthFromStatus(200)).toBe('ok')
    expect(healthFromStatus(401)).toBe('dead')
    expect(healthFromStatus(403)).toBe('dead')
    expect(healthFromStatus(429)).toBe('limited')
    expect(healthFromStatus(500)).toBe('unknown')
  })

  it('trusts an OpenRouter rejection and ignores an OpenAI usage rejection', () => {
    expect(healthFromUsageError('OpenRouter API error: 401', 'openrouter')).toBe('dead')
    expect(healthFromUsageError('OpenRouter API error: 429', 'openrouter')).toBe('limited')
    expect(healthFromUsageError('OpenAI API error: 401', 'openai')).toBe('')
  })

  it('names the state in Korean and sums a check', () => {
    expect(healthLabel('ok')).toBe('잘 돼요')
    expect(healthLabel('dead')).toBe('안 통해요')
    expect(healthLabel('')).toBe('')
    expect(checkSummary({ ok: 0, dead: 0, limited: 0, unknown: 0 })).toContain('확인할 수 있는')
    expect(checkSummary({ ok: 2, dead: 1, limited: 0, unknown: 0 })).toBe('키 3개를 확인했어요. 2개는 잘 돼요. 1개는 안 통해요.')
  })

  it('asks the model list, not the billing page, and classifies the answer', async () => {
    const target = probeTarget('OpenAI', 'sk-test')
    expect(target?.url).toBe('https://api.openai.com/v1/models')
    expect(target?.headers.Authorization).toBe('Bearer sk-test')
    const fetchImpl = (async () => ({ status: 401 })) as unknown as typeof fetch
    expect(await probeKey('OpenAI', 'sk-test', fetchImpl)).toBe('dead')
    expect(await probeKey('Slack', 'x', fetchImpl)).toBe('unknown')
  })
})

describe('writing a key back to env', () => {
  it('replaces the matching value and keeps quotes, comments, and other lines', () => {
    const text = 'PORT=3000\nOPENAI_API_KEY="sk-old-value-1234"\n# keep\n'
    const replaced = replaceEnvValue(text, 'OPENAI_API_KEY', 'sk-old-value-1234', 'sk-new-value-5678')
    expect(replaced.ok).toBe(true)
    expect(replaced.text).toBe('PORT=3000\nOPENAI_API_KEY="sk-new-value-5678"\n# keep\n')
  })

  it('refuses when the file already has a different value', () => {
    const replaced = replaceEnvValue('OPENAI_API_KEY=sk-someone-else\n', 'OPENAI_API_KEY', 'sk-old', 'sk-new')
    expect(replaced.ok).toBe(false)
    expect(replaced.message).toContain('이미 바뀌어서')
  })

  it('writes the file after keeping one backup, and restores it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-env-'))
    const file = path.join(dir, '.env')
    fs.writeFileSync(file, 'OPENAI_API_KEY=sk-old-value\nPORT=1\n')
    const written = writeEnvKey(file, 'OPENAI_API_KEY', 'sk-old-value', 'sk-new-value')
    expect(written.changed).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toContain('sk-new-value')
    expect(fs.readFileSync(written.backup, 'utf8')).toContain('sk-old-value')
    expect(restoreEnvBackup(file, written.backup)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toContain('sk-old-value')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
