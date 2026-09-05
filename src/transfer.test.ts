import { describe, expect, it } from 'vitest'
import {
  EXPORT_FORMAT,
  exportFileName,
  mergeSessions,
  parseSessionsFile,
  serializeSessions,
} from './transfer'
import type { Session } from './types'

const session = (id: string, title = id): Session =>
  ({ id, title, createdAt: 1, updatedAt: 1, viewIndex: 0, chain: [{ id: `${id}-c` }] }) as never

describe('serializeSessions / parseSessionsFile', () => {
  it('round-trips through the export wrapper', () => {
    const text = serializeSessions([session('a')], new Date('2026-09-05T10:00:00Z'))
    const parsed = JSON.parse(text)
    expect(parsed.format).toBe(EXPORT_FORMAT)
    expect(parsed.exportedAt).toBe('2026-09-05T10:00:00.000Z')
    expect(parseSessionsFile(text)).toEqual([session('a')])
  })

  it('accepts a raw sessions array and legacy draft-shaped sessions', () => {
    expect(parseSessionsFile('[{"id":"x","draft":"hello"}]')).toEqual([{ id: 'x', draft: 'hello' }])
  })

  it('drops entries that are not sessions', () => {
    const text = JSON.stringify({ sessions: [session('a'), { nope: 1 }, { id: 'b', chain: [] }] })
    expect(parseSessionsFile(text)).toEqual([session('a')])
  })

  it('rejects files that are not JSON or not an export', () => {
    expect(() => parseSessionsFile('{oops')).toThrow(/not valid JSON/)
    expect(() => parseSessionsFile('{"providers":[]}')).toThrow(/sessions export/)
    expect(() => parseSessionsFile('[]')).toThrow(/No sessions/)
    expect(() => parseSessionsFile('"str"')).toThrow(/sessions export/)
  })

  it('names the download by date', () => {
    expect(exportFileName(new Date('2026-09-05T23:59:00Z'))).toBe(
      'prompt-enhancer-sessions-2026-09-05.json',
    )
  })
})

describe('mergeSessions', () => {
  it('replaces sessions with a matching id and appends the rest', () => {
    const result = mergeSessions([session('a', 'old'), session('b')], [session('a', 'new'), session('c')])
    expect(result.sessions.map((s) => s.title)).toEqual(['new', 'b', 'c'])
    expect(result.added).toBe(1)
    expect(result.replaced).toBe(1)
  })

  it('does not mutate the input list', () => {
    const existing = [session('a')]
    mergeSessions(existing, [session('b')])
    expect(existing).toHaveLength(1)
  })
})
