/**
 * Resizable app-frame panes (sessions sidebar, Markdown preview). Pure
 * arithmetic only — no DOM — so the clamping rules are unit-testable.
 * `main.ts` measures the container and wires the pointer/keyboard handles.
 */

export type PaneId = 'sidebar' | 'preview'

/** Stored widths in CSS pixels; `null` means "use the CSS default". */
export interface LayoutState {
  sidebar: number | null
  preview: number | null
  /** Markdown preview pane hidden, giving the chain its track back */
  previewCollapsed: boolean
}

/** Hard bounds per pane, in px. The max is further limited by `CHAIN_MIN`. */
export const PANE_LIMITS: Record<PaneId, { min: number; max: number }> = {
  sidebar: { min: 176, max: 480 },
  preview: { min: 240, max: 960 },
}

/** The chain viewport never drops below this width while a pane is resized. */
export const CHAIN_MIN = 420

/** `gap-4` between grid tracks and `p-4` around the frame, in px. */
export const LAYOUT_GAP = 16

/** Width change per arrow-key press on a handle; Shift multiplies by 4. */
export const KEY_STEP = 16

export function emptyLayout(): LayoutState {
  return { sidebar: null, preview: null, previewCollapsed: false }
}

/**
 * Validate a stored (or otherwise untrusted) layout object. Anything that is
 * not a finite, positive number falls back to `null` (CSS default).
 */
export function normalizeLayout(raw: unknown): LayoutState {
  const out = emptyLayout()
  if (!raw || typeof raw !== 'object') return out
  for (const pane of ['sidebar', 'preview'] as const) {
    const value = (raw as Record<string, unknown>)[pane]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[pane] = Math.round(value)
    }
  }
  out.previewCollapsed = (raw as Record<string, unknown>).previewCollapsed === true
  return out
}

/**
 * Clamp a requested pane width to its hard bounds and to the room actually
 * available: the frame's content width minus the other pane in the same
 * row (0 when it sits in its own row), the two gaps, and the chain minimum.
 * When even the minimum doesn't fit, the minimum wins — the chain flexes.
 */
export function clampPaneWidth(
  pane: PaneId,
  width: number,
  containerWidth: number,
  otherPaneWidth: number,
): number {
  const { min, max } = PANE_LIMITS[pane]
  const room = containerWidth - otherPaneWidth - 2 * LAYOUT_GAP - CHAIN_MIN
  const ceiling = Math.max(min, Math.min(max, room))
  if (!Number.isFinite(width)) return min
  return Math.round(Math.min(Math.max(width, min), ceiling))
}

/**
 * New width after the handle moves `dx` px to the right. The sidebar's
 * handle sits on its right edge (moving right grows it); the preview's on
 * its left edge (moving right shrinks it).
 */
export function widthAfterDrag(pane: PaneId, startWidth: number, dx: number): number {
  return pane === 'sidebar' ? startWidth + dx : startWidth - dx
}

/**
 * Re-fit stored widths after the frame changed size. Each stored pane is
 * first held to its hard bounds; if the row still can't leave the chain
 * `CHAIN_MIN`, the stored panes give up width in proportion to their slack
 * above the minimum, so neither is squeezed flat while the other keeps its
 * size. Panes on the CSS default (`null`) already scale with the viewport
 * and are left alone; `current` supplies their rendered width. Only panes
 * in `row` compete: from xl both flank the chain, below that just the sidebar.
 */
export function fitPanes(
  stored: LayoutState,
  current: Record<PaneId, number>,
  containerWidth: number,
  row: PaneId[],
): LayoutState {
  const out: LayoutState = { ...stored }
  for (const pane of row) {
    const value = out[pane]
    if (value !== null) {
      out[pane] = Math.min(Math.max(value, PANE_LIMITS[pane].min), PANE_LIMITS[pane].max)
    }
  }
  const available = containerWidth - 2 * LAYOUT_GAP - CHAIN_MIN
  const used = row.reduce((sum, pane) => sum + (out[pane] ?? current[pane]), 0)
  const excess = used - available
  if (excess <= 0) return out
  const slackOf = (pane: PaneId) => Math.max(0, (out[pane] ?? 0) - PANE_LIMITS[pane].min)
  const adjustable = row.filter((pane) => out[pane] !== null)
  const slack = adjustable.reduce((sum, pane) => sum + slackOf(pane), 0)
  if (slack === 0) return out
  const ratio = Math.min(1, excess / slack)
  for (const pane of adjustable) {
    out[pane] = Math.round((out[pane] as number) - ratio * slackOf(pane))
  }
  return out
}
