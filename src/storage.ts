import type { LayoutState } from './layout'
import { normalizeLayout } from './layout'
import type { BestPracticeCollection, DefaultSettings, Provider, Session } from './types'
import { factoryDefaults } from './types'

export const KEYS = {
  providers: 'pe.providers',
  sessions: 'pe.sessions',
  /** Safety copy of the sessions blob, taken once before this version's first write */
  sessionsBackup: 'pe.sessions.backup',
  /** When the safety copy was taken and whether it is still held */
  sessionsBackupMeta: 'pe.sessions.backup.meta',
  /** Unreadable data parked instead of being overwritten */
  quarantine: 'pe.sessions.quarantine',
  /** Ids of sessions deleted here, so another tab's stale copy can't resurrect them */
  deleted: 'pe.deleted',
  activeSession: 'pe.activeSession',
  bestPractices: 'pe.bestPractices',
  defaults: 'pe.defaults',
  /** Resizable pane widths (sessions sidebar, Markdown preview) */
  layout: 'pe.layout',
} as const

/**
 * Shown when a write fails. localStorage is capped at ~5 MB per origin and
 * throws on quota; it can also be unavailable entirely (blocked site data).
 */
export const STORAGE_ERROR_MESSAGE =
  'Your changes could not be saved: browser storage is full or unavailable. Delete old sessions to free space, then edit again.'

/**
 * Largest sessions blob worth duplicating as a safety copy. The copy competes
 * for the same ~5 MB quota as the data it protects, so above this size the
 * backup would cost the user more writes than it could ever save.
 */
const BACKUP_MAX_CHARS = 512 * 1024

/** How long the safety copy is held before its space is reclaimed. */
const BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Deletion markers older than this are dropped; the delete has propagated. */
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Upper bound on markers kept, newest first, so the list can't grow forever. */
const TOMBSTONE_CAP = 200

interface BackupMeta {
  /** When the copy was taken */
  at: number
  /** Whether the copy is still held (false = never taken, or since reclaimed) */
  kept: boolean
}

/** One deleted session, remembered long enough for other tabs to catch up. */
export interface Tombstone {
  id: string
  at: number
}

/** Raw string read that never throws (storage may be blocked entirely). */
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

function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* storage blocked — nothing to remove */
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

/**
 * Sessions as stored, with enough detail for the caller to tell "nothing
 * saved yet" from "saved, but unreadable" — the second must never be
 * silently replaced with a fresh empty session.
 */
export interface SessionsRead {
  sessions: Session[]
  /** A value was stored but could not be parsed into an array of sessions */
  corrupt: boolean
  /** The stored string, so an unreadable value can be parked rather than lost */
  raw: string | null
}

export const storage = {
  loadProviders: (): Provider[] => load<Provider[]>(KEYS.providers, []),
  saveProviders: (providers: Provider[]): boolean => save(KEYS.providers, providers),

  readSessions: (): SessionsRead => {
    const raw = readRaw(KEYS.sessions)
    if (raw === null) return { sessions: [], corrupt: false, raw }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return { sessions: [], corrupt: true, raw }
      return { sessions: parsed as Session[], corrupt: false, raw }
    } catch {
      return { sessions: [], corrupt: true, raw }
    }
  },

  loadSessions: (): Session[] => storage.readSessions().sessions,

  /**
   * Pass a raw (non-reactive) array: serializing through Alpine's reactive
   * proxy costs ~60% more, and this is the hottest write in the app.
   */
  saveSessions: (sessions: Session[]): boolean => save(KEYS.sessions, sessions),

  /**
   * Hold one untouched copy of the sessions blob as the previous version
   * stored it, so a migration bug can't destroy the only copy. Taken at most
   * once, skipped when the blob is large enough that the duplicate would eat
   * the quota it is meant to protect, and reclaimed after a week.
   */
  backupSessionsOnce: (): void => {
    const meta = load<BackupMeta | null>(KEYS.sessionsBackupMeta, null)
    if (meta) {
      if (meta.kept && Date.now() - meta.at > BACKUP_TTL_MS) {
        removeRaw(KEYS.sessionsBackup)
        save(KEYS.sessionsBackupMeta, { at: meta.at, kept: false })
      }
      return
    }
    const raw = readRaw(KEYS.sessions)
    if (raw === null) return
    const kept = raw.length <= BACKUP_MAX_CHARS && writeRaw(KEYS.sessionsBackup, raw)
    save(KEYS.sessionsBackupMeta, { at: Date.now(), kept })
  },

  /**
   * Park data that could not be read rather than overwriting it. Recoverable
   * from devtools under `pe.sessions.quarantine`; the app only ever writes it.
   */
  quarantine: (reason: string, data: unknown): boolean =>
    save(KEYS.quarantine, { at: Date.now(), reason, data }),

  /** Deletion markers, pruned of anything past the propagation window. */
  loadDeleted: (): Tombstone[] => {
    const now = Date.now()
    const raw = load<unknown>(KEYS.deleted, [])
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (t): t is Tombstone =>
        Boolean(t) &&
        typeof (t as Tombstone).id === 'string' &&
        Number.isFinite((t as Tombstone).at) &&
        now - (t as Tombstone).at < TOMBSTONE_TTL_MS,
    )
  },

  /** Record a deleted session id; keeps only the newest `TOMBSTONE_CAP`. */
  addDeleted: (id: string): boolean => {
    const list = storage.loadDeleted().filter((t) => t.id !== id)
    list.push({ id, at: Date.now() })
    return save(KEYS.deleted, list.slice(-TOMBSTONE_CAP))
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

  /** Pane widths, validated so a corrupt value can never break the grid. */
  loadLayout: (): LayoutState => normalizeLayout(load<unknown>(KEYS.layout, null)),
  saveLayout: (layout: LayoutState): boolean => save(KEYS.layout, layout),
}
