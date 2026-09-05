import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storage } from './storage'

/** Minimal in-memory localStorage; `failWrites` simulates a full quota. */
function fakeStorage(opts: { failWrites?: boolean; blocked?: boolean } = {}) {
  const data = new Map<string, string>()
  const quota = () => {
    const err = new Error('QuotaExceededError')
    err.name = 'QuotaExceededError'
    return err
  }
  return {
    data,
    getItem(key: string) {
      if (opts.blocked) throw new Error('SecurityError')
      return data.has(key) ? data.get(key)! : null
    },
    setItem(key: string, value: string) {
      if (opts.blocked) throw new Error('SecurityError')
      if (opts.failWrites) throw quota()
      data.set(key, String(value))
    },
    removeItem(key: string) {
      data.delete(key)
    },
  }
}

describe('storage', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    vi.unstubAllGlobals()
  })

  it('round-trips sessions and reports success', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    const sessions = [{ id: 's1', chain: [] }] as never
    expect(storage.saveSessions(sessions)).toBe(true)
    expect(storage.loadSessions()).toEqual([{ id: 's1', chain: [] }])
  })

  it('returns false instead of throwing when the quota is exceeded', () => {
    vi.stubGlobal('localStorage', fakeStorage({ failWrites: true }))
    expect(storage.saveSessions([] as never)).toBe(false)
    expect(storage.saveActiveSession('x')).toBe(false)
    expect(storage.saveProviders([])).toBe(false)
    expect(storage.saveBestPractices([])).toBe(false)
    expect(storage.saveDefaults(storage.loadDefaults())).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('never throws when storage is blocked entirely', () => {
    vi.stubGlobal('localStorage', fakeStorage({ blocked: true }))
    expect(storage.loadSessions()).toEqual([])
    expect(storage.loadActiveSession()).toBeNull()
    expect(storage.loadDefaults().outputLanguage).toBe('English')
    expect(storage.saveSessions([] as never)).toBe(false)
    expect(() => storage.backupSessionsOnce()).not.toThrow()
  })

  it('falls back on corrupt JSON instead of throwing', () => {
    const ls = fakeStorage()
    ls.data.set('pe.sessions', '{not json')
    vi.stubGlobal('localStorage', ls)
    expect(storage.loadSessions()).toEqual([])
  })

  it('backs up the raw sessions blob exactly once', () => {
    const ls = fakeStorage()
    ls.data.set('pe.sessions', '[{"id":"old"}]')
    vi.stubGlobal('localStorage', ls)
    storage.backupSessionsOnce()
    expect(ls.data.get('pe.sessions.backup')).toBe('[{"id":"old"}]')
    ls.data.set('pe.sessions', '[{"id":"new"}]')
    storage.backupSessionsOnce()
    expect(ls.data.get('pe.sessions.backup')).toBe('[{"id":"old"}]')
  })

  it('does not create a backup when nothing was stored', () => {
    const ls = fakeStorage()
    vi.stubGlobal('localStorage', ls)
    storage.backupSessionsOnce()
    expect(ls.data.has('pe.sessions.backup')).toBe(false)
  })
})
