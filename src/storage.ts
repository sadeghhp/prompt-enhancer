import type { BestPracticeCollection, DefaultSettings, Provider, Session } from './types'
import { factoryDefaults } from './types'

const KEYS = {
  providers: 'pe.providers',
  sessions: 'pe.sessions',
  activeSession: 'pe.activeSession',
  bestPractices: 'pe.bestPractices',
  defaults: 'pe.defaults',
} as const

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn(`Failed to persist ${key} (storage full or unavailable):`, err)
  }
}

export const storage = {
  loadProviders: (): Provider[] => load<Provider[]>(KEYS.providers, []),
  saveProviders: (providers: Provider[]) => save(KEYS.providers, providers),

  loadSessions: (): Session[] => load<Session[]>(KEYS.sessions, []),
  saveSessions: (sessions: Session[]) => save(KEYS.sessions, sessions),

  loadActiveSession: (): string | null => localStorage.getItem(KEYS.activeSession),
  saveActiveSession: (id: string) => localStorage.setItem(KEYS.activeSession, id),

  loadBestPractices: (): BestPracticeCollection[] =>
    load<BestPracticeCollection[]>(KEYS.bestPractices, []),
  saveBestPractices: (collections: BestPracticeCollection[]) =>
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
  saveDefaults: (defaults: DefaultSettings) => save(KEYS.defaults, defaults),
}
