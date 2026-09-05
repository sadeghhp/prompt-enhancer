import { describe, expect, it } from 'vitest'
import {
  MAX_REASONING_CHARS,
  MAX_TITLE_CHARS,
  REASONING_TRUNCATED_MARKER,
  capReasoning,
  titleFromPrompt,
} from './types'

describe('titleFromPrompt', () => {
  it('uses the first line and falls back on empty input', () => {
    expect(titleFromPrompt('Write a brief\nmore detail here')).toBe('Write a brief')
    expect(titleFromPrompt('   \n  ')).toBe('New session')
    expect(titleFromPrompt('', 'Keep me')).toBe('Keep me')
  })

  it('trims long titles by character, never splitting an emoji', () => {
    // 50 emoji: 100 UTF-16 units, so a naive slice(0, 42) would cut one in half.
    const title = titleFromPrompt('🚀'.repeat(50))
    expect(Array.from(title)).toHaveLength(MAX_TITLE_CHARS + 1) // + the ellipsis
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toContain('�')
    expect(title.slice(0, -1)).toBe('🚀'.repeat(MAX_TITLE_CHARS))
  })

  it('leaves a title at exactly the limit alone', () => {
    const exact = 'a'.repeat(MAX_TITLE_CHARS)
    expect(titleFromPrompt(exact)).toBe(exact)
  })
})

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
