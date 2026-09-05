import { describe, expect, it } from 'vitest'
import { clampView, viewIndexAfterEnhance } from './view'

describe('clampView', () => {
  it('never goes below 0 or above chainLength - visible', () => {
    expect(clampView(-3, 5, 2)).toBe(0)
    expect(clampView(99, 5, 2)).toBe(3)
    expect(clampView(2, 5, 2)).toBe(2)
  })

  it('lets the last link become the leading column on narrow screens (one visible)', () => {
    // Regression: the old clamp assumed two visible columns, so on phones
    // the newest link could never be brought fully into view.
    expect(clampView(4, 5, 1)).toBe(4)
    expect(clampView(10, 5, 1)).toBe(4)
  })

  it('keeps three columns filled on very wide screens', () => {
    expect(clampView(9, 5, 3)).toBe(2)
  })

  it('handles single-link chains and degenerate inputs', () => {
    expect(clampView(0, 1, 2)).toBe(0)
    expect(clampView(5, 0, 2)).toBe(0)
    expect(clampView(1.7, 5, 2.9)).toBe(1)
    expect(clampView(3, 5, 0)).toBe(3) // visible floors to 1
  })
})

describe('viewIndexAfterEnhance', () => {
  // Enhancing from index 2 of a 3-link chain: chain becomes 4 links, new at 3.
  it('shows source + new link side by side with two columns', () => {
    expect(viewIndexAfterEnhance(3, 4, 2)).toBe(2)
  })
  it('shows the new link alone with one column', () => {
    expect(viewIndexAfterEnhance(3, 4, 1)).toBe(3)
  })
  it('fills all three slots ending on the new link with three columns', () => {
    expect(viewIndexAfterEnhance(3, 4, 3)).toBe(1)
    expect(viewIndexAfterEnhance(1, 2, 3)).toBe(0)
  })
})
