/**
 * Session export/import. Everything lives in localStorage (capped at ~5 MB
 * per origin, wiped with site data), so this is the only way to back work
 * up or move it between browsers. Providers and API keys are deliberately
 * left out: the file is meant to be shareable.
 */
import type { Session } from './types'

export const EXPORT_FORMAT = 'prompt-enhancer/sessions'
export const EXPORT_VERSION = 1

export interface SessionsExport {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: string
  sessions: Session[]
}

export function serializeSessions(sessions: Session[], now = new Date()): string {
  const payload: SessionsExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    sessions,
  }
  return JSON.stringify(payload, null, 2)
}

/** Suggested download name, e.g. `prompt-enhancer-sessions-2026-09-05.json`. */
export function exportFileName(now = new Date()): string {
  return `prompt-enhancer-sessions-${now.toISOString().slice(0, 10)}.json`
}

function looksLikeSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  if (typeof s.id !== 'string' || !s.id) return false
  // Either a chain (current shape) or the legacy draft/versions shape,
  // which `migrateSession` in main.ts still understands.
  return Array.isArray(s.chain) ? s.chain.length > 0 : typeof s.draft === 'string'
}

/**
 * Parse an export file (or a raw sessions array) into sessions. Throws an
 * Error with a message fit for the UI when the file is not one of ours.
 * The result still needs `migrateSession` before use.
 */
export function parseSessionsFile(text: string): Session[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as SessionsExport).sessions)
      ? (data as SessionsExport).sessions
      : null
  if (!list) throw new Error('That file does not contain a Prompt Enhancer sessions export.')
  const sessions = list.filter(looksLikeSession)
  if (sessions.length === 0) throw new Error('No sessions were found in that file.')
  return sessions
}

/**
 * Merge imported sessions into the existing list: an import with the same
 * id replaces the stored session (re-importing a backup restores it), new
 * ids are appended. Returns the new list plus how many of each happened.
 */
export function mergeSessions(
  existing: Session[],
  imported: Session[],
): { sessions: Session[]; added: number; replaced: number } {
  const sessions = [...existing]
  let added = 0
  let replaced = 0
  for (const s of imported) {
    const at = sessions.findIndex((x) => x.id === s.id)
    if (at === -1) {
      sessions.push(s)
      added++
    } else {
      sessions[at] = s
      replaced++
    }
  }
  return { sessions, added, replaced }
}
