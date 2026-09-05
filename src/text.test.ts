import { describe, expect, it } from 'vitest'
import { describeLength, wordCount } from './text'

describe('wordCount', () => {
  it('counts whitespace-separated words and ignores padding', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('   \n ')).toBe(0)
    expect(wordCount('one')).toBe(1)
    expect(wordCount('  one\ttwo\n\nthree  ')).toBe(3)
  })
})

describe('describeLength', () => {
  it('reads "empty" for blank text', () => {
    expect(describeLength('  ')).toBe('empty')
  })

  it('reports words and characters with correct plurals', () => {
    expect(describeLength('hi')).toBe('1 word · 2 chars')
    expect(describeLength('hi there')).toBe('2 words · 8 chars')
  })

  it('appends the word-count change against the previous link', () => {
    expect(describeLength('a b c d', 'a b c d e f g h')).toBe('4 words · 7 chars (−50% words)')
    expect(describeLength('a b c d', 'a b')).toBe('4 words · 7 chars (+100% words)')
    expect(describeLength('a b', 'c d')).toBe('2 words · 3 chars (±0% words)')
  })

  it('omits the change when the previous link is empty', () => {
    expect(describeLength('a b', '')).toBe('2 words · 3 chars')
  })
})
