import { describe, expect, it } from 'vitest'
import { MAX_REASONING_CHARS, REASONING_TRUNCATED_MARKER, capReasoning } from './types'

describe('capReasoning', () => {
  it('returns short text untouched', () => {
    expect(capReasoning('')).toBe('')
    const exact = 'x'.repeat(MAX_REASONING_CHARS)
    expect(capReasoning(exact)).toBe(exact)
  })

  it('keeps the head and appends a marker past the cap', () => {
    const long = 'a'.repeat(MAX_REASONING_CHARS + 500)
    const capped = capReasoning(long)
    expect(capped.startsWith('a'.repeat(MAX_REASONING_CHARS))).toBe(true)
    expect(capped.endsWith(REASONING_TRUNCATED_MARKER)).toBe(true)
    expect(capped.length).toBe(MAX_REASONING_CHARS + REASONING_TRUNCATED_MARKER.length)
  })

  it('is idempotent on already-capped text', () => {
    const once = capReasoning('b'.repeat(MAX_REASONING_CHARS * 2))
    expect(capReasoning(once)).toBe(once)
  })
})
