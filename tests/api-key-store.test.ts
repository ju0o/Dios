import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { addApiKey, deleteApiKey, knownProjects, revealApiKey, updateApiKey, type SecretLock } from '../src/core/api-keys/api-key-store'

/** Stand-in for the OS key store: reversible, and clearly not the plain text. */
const LOCK: SecretLock = {
  available: () => true,
  lock: (plain) => Buffer.from(plain, 'utf8').reverse().toString('base64'),
  unlock: (locked) => Buffer.from(locked, 'base64').reverse().toString('utf8'),
}

function openDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dios-keys-'))
  return new Database(path.join(dir, 'keys.db'))
}

describe('api key store', () => {
  it('locks the secret on disk and shows only the mask', () => {
    const db = openDb()
    const added = addApiKey(db, LOCK, { project: 'Dios', platform: 'OpenAI', label: '', key: 'sk-proj-abcdefghijklmnop1234', note: '' })
    expect(added.ok).toBe(true)
    expect(added.cards[0].masked).toBe('sk-••••••••1234')
    expect(added.cards[0].plain).toBe(false)
    const raw = db.prepare('SELECT key_locked FROM api_keys').get() as { key_locked: string }
    expect(raw.key_locked).not.toContain('sk-proj')
    expect(revealApiKey(db, LOCK, added.cards[0].id).key).toBe('sk-proj-abcdefghijklmnop1234')
  })

  it('edits the words without touching the key, then replaces the key when a new one is typed', () => {
    const db = openDb()
    const id = addApiKey(db, LOCK, { project: 'Dios', platform: 'GitHub', label: '', key: 'ghp_abcdefghijklmnopqrstuvwxyz', note: '' }).cards[0].id
    const edited = updateApiKey(db, LOCK, id, { project: 'Dios', platform: 'GitHub', label: '운영용', key: '', note: '월 20달러' })
    expect(edited.ok).toBe(true)
    expect(edited.message).toBe('고쳤어요. 키는 그대로예요.')
    expect(edited.cards[0].label).toBe('운영용')
    expect(edited.cards[0].masked).toBe('ghp_••••••••wxyz')
    const replaced = updateApiKey(db, LOCK, id, { project: 'Dios', platform: 'GitHub', label: '운영용', key: 'ghp_zyxwvutsrqponmlkjihgfedcba', note: '' })
    expect(replaced.cards[0].masked).toBe('ghp_••••••••dcba')
    expect(revealApiKey(db, LOCK, id).key).toBe('ghp_zyxwvutsrqponmlkjihgfedcba')
  })

  it('refuses a duplicate, lists projects, and deletes', () => {
    const db = openDb()
    addApiKey(db, LOCK, { project: 'JuPlan', platform: 'OpenAI', label: '', key: 'sk-abcdefghijklmnop', note: '' })
    const dup = addApiKey(db, LOCK, { project: 'JuPlan', platform: 'OpenAI', label: '', key: 'sk-other-abcdefghijklmnop', note: '' })
    expect(dup.ok).toBe(false)
    expect(knownProjects(db, ['Dios'])).toEqual(['Dios', 'JuPlan'])
    const gone = deleteApiKey(db, dup.cards[0].id)
    expect(gone.ok).toBe(true)
    expect(gone.cards).toHaveLength(0)
  })

  it('stores plain text only when the computer has no lock, and says so', () => {
    const db = openDb()
    const plainLock: SecretLock = { available: () => false, lock: (p) => p, unlock: (l) => l }
    const added = addApiKey(db, plainLock, { project: 'Dios', platform: 'AWS', label: '', key: 'AKIAABCDEFGHIJKLMNOP', note: '' })
    expect(added.message).toContain('키가 그대로 저장됐어요')
    expect(added.cards[0].plain).toBe(true)
  })
})
