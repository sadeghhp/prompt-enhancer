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

  it('round-trips pane widths and sanitizes stored garbage', () => {
    const ls = fakeStorage()
    vi.stubGlobal('localStorage', ls)
    const empty = { sidebar: null, preview: null, previewCollapsed: false }
    expect(storage.loadLayout()).toEqual(empty)
    expect(storage.saveLayout({ sidebar: 300, preview: null, previewCollapsed: true })).toBe(true)
    expect(storage.loadLayout()).toEqual({ sidebar: 300, preview: null, previewCollapsed: true })
    ls.data.set('pe.layout', '{"sidebar":"wide","preview":-1}')
    expect(storage.loadLayout()).toEqual(empty)
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

  it('skips the backup when the blob is large enough to eat the quota', () => {
    const ls = fakeStorage()
    // Over the 512 KB budget: duplicating this would cost more quota than it
    // could ever protect, so only the decision is recorded.
    ls.data.set('pe.sessions', `["${'x'.repeat(600 * 1024)}"]`)
    vi.stubGlobal('localStorage', ls)
    storage.backupSessionsOnce()
    expect(ls.data.has('pe.sessions.backup')).toBe(false)
    expect(JSON.parse(ls.data.get('pe.sessions.backup.meta')!).kept).toBe(false)
    // And it never retries on a later boot.
    ls.data.set('pe.sessions', '[]')
    storage.backupSessionsOnce()
    expect(ls.data.has('pe.sessions.backup')).toBe(false)
  })

  it('reclaims the backup once it is older than a week, and never retakes it', () => {
    const ls = fakeStorage()
    ls.data.set('pe.sessions', '[{"id":"old"}]')
    vi.stubGlobal('localStorage', ls)
    storage.backupSessionsOnce()
    expect(ls.data.has('pe.sessions.backup')).toBe(true)

    const meta = JSON.parse(ls.data.get('pe.sessions.backup.meta')!)
    meta.at = Date.now() - 8 * 24 * 60 * 60 * 1000
    ls.data.set('pe.sessions.backup.meta', JSON.stringify(meta))
    storage.backupSessionsOnce()
    expect(ls.data.has('pe.sessions.backup')).toBe(false)

    storage.backupSessionsOnce()
    expect(ls.data.has('pe.sessions.backup')).toBe(false)
  })

  it('reports unreadable sessions instead of silently returning none', () => {
    const ls = fakeStorage()
    vi.stubGlobal('localStorage', ls)
    expect(storage.readSessions()).toEqual({ sessions: [], corrupt: false, raw: null })

    ls.data.set('pe.sessions', '{not json')
    expect(storage.readSessions()).toMatchObject({ sessions: [], corrupt: true })

    // Valid JSON that is not an array is just as unusable.
    ls.data.set('pe.sessions', '{"nope":1}')
    expect(storage.readSessions()).toMatchObject({ sessions: [], corrupt: true })

    ls.data.set('pe.sessions', '[{"id":"a"}]')
    expect(storage.readSessions()).toMatchObject({ corrupt: false })
  })

  it('records deletions, dedupes them and prunes expired ones', () => {
    const ls = fakeStorage()
    vi.stubGlobal('localStorage', ls)
    storage.addDeleted('a')
    storage.addDeleted('b')
    storage.addDeleted('a')
    expect(storage.loadDeleted().map((t) => t.id)).toEqual(['b', 'a'])

    const stale = [{ id: 'ancient', at: Date.now() - 40 * 24 * 60 * 60 * 1000 }]
    ls.data.set('pe.deleted', JSON.stringify(stale))
    expect(storage.loadDeleted()).toEqual([])

    ls.data.set('pe.deleted', '{"not":"an array"}')
    expect(storage.loadDeleted()).toEqual([])
  })

  it('parks unreadable data under the quarantine key', () => {
    const ls = fakeStorage()
    vi.stubGlobal('localStorage', ls)
    expect(storage.quarantine('unreadable', '{broken')).toBe(true)
    const parked = JSON.parse(ls.data.get('pe.sessions.quarantine')!)
    expect(parked.reason).toBe('unreadable')
    expect(parked.data).toBe('{broken')
  })
})
