import { describe, expect, it } from 'vitest'
import {
  CHAIN_MIN,
  LAYOUT_GAP,
  PANE_LIMITS,
  clampPaneWidth,
  fitPanes,
  normalizeLayout,
  widthAfterDrag,
} from './layout'

/** A layout state with the preview shown; the shape every test compares to. */
const L = (sidebar: number | null, preview: number | null, previewCollapsed = false) => ({
  sidebar,
  preview,
  previewCollapsed,
})

describe('normalizeLayout', () => {
  it('returns nulls for missing, corrupt, or non-numeric input', () => {
    expect(normalizeLayout(undefined)).toEqual(L(null, null))
    expect(normalizeLayout('nope')).toEqual(L(null, null))
    expect(normalizeLayout({ sidebar: '300', preview: NaN })).toEqual(L(null, null))
    expect(normalizeLayout({ sidebar: -5, preview: Infinity })).toEqual(L(null, null))
  })

  it('keeps finite positive widths, rounded to whole pixels', () => {
    expect(normalizeLayout({ sidebar: 240.6, preview: 400 })).toEqual(L(241, 400))
  })

  it('only honours a literal true for the collapsed flag', () => {
    expect(normalizeLayout({ previewCollapsed: true })).toEqual(L(null, null, true))
    expect(normalizeLayout({ previewCollapsed: 'yes' })).toEqual(L(null, null, false))
  })
})

describe('clampPaneWidth', () => {
  // A 1600px frame with a 256px sidebar leaves the preview
  // 1600 - 256 - 32 - 420 = 892px of room.
  it('clamps to the hard bounds', () => {
    expect(clampPaneWidth('preview', 10, 1600, 256)).toBe(PANE_LIMITS.preview.min)
    expect(clampPaneWidth('sidebar', 5000, 1600, 0)).toBe(PANE_LIMITS.sidebar.max)
  })

  it('never lets the chain viewport drop below CHAIN_MIN', () => {
    expect(clampPaneWidth('preview', 950, 1600, 256)).toBe(1600 - 256 - 2 * LAYOUT_GAP - CHAIN_MIN)
  })

  it('passes a width that fits through untouched (rounded)', () => {
    expect(clampPaneWidth('preview', 400.4, 1600, 256)).toBe(400)
  })

  it('falls back to the minimum when the frame is too small or width is not a number', () => {
    expect(clampPaneWidth('preview', 400, 500, 256)).toBe(PANE_LIMITS.preview.min)
    expect(clampPaneWidth('sidebar', NaN, 1600, 0)).toBe(PANE_LIMITS.sidebar.min)
  })
})

describe('widthAfterDrag', () => {
  it('grows the sidebar and shrinks the preview when the handle moves right', () => {
    expect(widthAfterDrag('sidebar', 256, 40)).toBe(296)
    expect(widthAfterDrag('preview', 360, 40)).toBe(320)
  })
})

describe('fitPanes', () => {
  const row: ('sidebar' | 'preview')[] = ['sidebar', 'preview']
  const current = { sidebar: 224, preview: 320 }

  it('leaves widths alone when everything fits', () => {
    expect(fitPanes(L(300, 500), current, 1600, row)).toEqual(L(300, 500))
  })

  it('preserves nulls and never touches a pane on the CSS default', () => {
    // 1000 - 32 - 420 = 548 available; 224 (default) + 500 = 724 → preview gives up 176
    expect(fitPanes(L(null, 500), current, 1000, row)).toEqual(L(null, 324))
  })

  it('shrinks both stored panes in proportion to their slack', () => {
    // available = 1000 - 32 - 420 = 548; used = 376 + 640 = 1016; excess = 468
    // slack: sidebar 200, preview 400 (total 600) → ratio 0.78
    const fitted = fitPanes(L(376, 640), current, 1000, row)
    expect(fitted).toEqual(L(220, 328))
    expect(fitted.sidebar! + fitted.preview!).toBe(548)
  })

  it('stops at the minimums when there is no more slack', () => {
    expect(fitPanes(L(480, 960), current, 600, row)).toEqual(
      L(PANE_LIMITS.sidebar.min, PANE_LIMITS.preview.min),
    )
  })

  it('holds stored widths to the hard bounds first', () => {
    expect(fitPanes(L(9999, 1), current, 5000, row)).toEqual(
      L(PANE_LIMITS.sidebar.max, PANE_LIMITS.preview.min),
    )
  })

  it('ignores the preview when it sits in its own row (or is collapsed)', () => {
    expect(fitPanes(L(300, 900, true), current, 900, ['sidebar'])).toEqual(L(300, 900, true))
  })
})
