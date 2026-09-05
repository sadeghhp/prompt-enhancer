import type { BestPracticeCollection, DefaultSettings, Provider, Session } from './types'
import { factoryDefaults } from './types'

const KEYS = {
  providers: 'pe.providers',
  sessions: 'pe.sessions',
  /** One-time copy of the raw sessions blob, taken before this version's first write */
  sessionsBackup: 'pe.sessions.backup',
  activeSession: 'pe.activeSession',
  bestPractices: 'pe.bestPractices',
  defaults: 'pe.defaults',
} as const

/**
 * Shown when a write fails. localStorage is capped at ~5 MB per origin and
 * throws on quota; it can also be unavailable entirely (blocked site data).
 */
export const STORAGE_ERROR_MESSAGE =
  'Your changes could not be saved: browser storage is full or unavailable. Delete old sessions to free space, then edit again.'

/** Raw string read that never throws (storage may be blocked). */
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Raw string write that reports success instead of throwing. */
function writeRaw(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (err) {
    console.warn(`Failed to persist ${key} (storage full or unavailable):`, err)
    return false
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = readRaw(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): boolean {
  return writeRaw(key, JSON.stringify(value))
}

export const storage = {
  loadProviders: (): Provider[] => load<Provider[]>(KEYS.providers, []),
  saveProviders: (providers: Provider[]): boolean => save(KEYS.providers, providers),

  loadSessions: (): Session[] => load<Session[]>(KEYS.sessions, []),
  /**
   * Pass a raw (non-reactive) array: serializing through Alpine's reactive
   * proxy costs ~60% more, and this is the hottest write in the app.
   */
  saveSessions: (sessions: Session[]): boolean => save(KEYS.sessions, sessions),

  /**
   * Keep one untouched copy of the sessions blob as stored by the previous
   * version, so a migration bug never destroys the only copy. Written once;
   * later calls are no-ops.
   */
  backupSessionsOnce: (): void => {
    if (readRaw(KEYS.sessionsBackup) !== null) return
    const raw = readRaw(KEYS.sessions)
    if (raw !== null) writeRaw(KEYS.sessionsBackup, raw)
  },

  loadActiveSession: (): string | null => readRaw(KEYS.activeSession),
  saveActiveSession: (id: string): boolean => writeRaw(KEYS.activeSession, id),

  loadBestPractices: (): BestPracticeCollection[] =>
    load<BestPracticeCollection[]>(KEYS.bestPractices, []),
  saveBestPractices: (collections: BestPracticeCollection[]): boolean =>
    save(KEYS.bestPractices, collections),

  /**
   * Merge stored defaults over the factory defaults so fields added after a
   * user first saved (e.g. new option toggles) always resolve to a value.
   */
  loadDefaults: (): DefaultSettings => {
    const base = factoryDefaults()
    const stored = load<Partial<DefaultSettings>>(KEYS.defaults, {})
    return {
      outputLanguage: stored.outputLanguage ?? base.outputLanguage,
      outputFormat: stored.outputFormat ?? base.outputFormat,
      options: { ...base.options, ...(stored.options ?? {}) },
    }
  },
  saveDefaults: (defaults: DefaultSettings): boolean => save(KEYS.defaults, defaults),
}
