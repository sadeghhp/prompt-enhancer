import type { Provider, Session } from './types'

const KEYS = {
  providers: 'pe.providers',
  sessions: 'pe.sessions',
  activeSession: 'pe.activeSession',
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
}
