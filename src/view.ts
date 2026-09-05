/**
 * Pure chain-viewport arithmetic, kept free of DOM access so it can be unit
 * tested. `main.ts` supplies the visible-column count from `matchMedia`.
 */

/**
 * Clamp a viewIndex so the last column can always become the last visible
 * slot: the highest index is `chainLength - visible`, never below 0.
 */
export function clampView(index: number, chainLength: number, visible: number): number {
  const safeVisible = Math.max(1, Math.floor(visible))
  return Math.min(Math.max(0, Math.floor(index)), Math.max(0, chainLength - safeVisible))
}

/**
 * Where to slide after a new link is appended at `newIndex`, so that the new
 * link is the last visible column: source + new on two-column desktops, the
 * new link alone on narrow screens, and no empty trailing slot at three.
 */
export function viewIndexAfterEnhance(newIndex: number, chainLength: number, visible: number): number {
  return clampView(newIndex, chainLength, visible)
}
