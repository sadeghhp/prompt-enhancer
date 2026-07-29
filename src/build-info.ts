/**
 * Build stamp shown in the page footer. The three constants are replaced at
 * build time by Vite's `define` (see vite.config.ts); during `npm run dev`
 * they still resolve, so the footer works in both modes.
 */
declare const __APP_VERSION__: string
declare const __BUILD_NUMBER__: string
declare const __BUILD_TIME__: string

export const APP_VERSION = __APP_VERSION__
export const BUILD_NUMBER = __BUILD_NUMBER__
export const BUILD_TIME = __BUILD_TIME__

const HAPPY_EMOJI = ['✨', '🎉', '🚀', '🌈', '😄', '🥳', '💫', '🌟', '🍀', '🧠', '💡', '🎈']

/** Two distinct happy emoji, picked fresh on each page load. */
function randomEmoji(): string {
  const first = Math.floor(Math.random() * HAPPY_EMOJI.length)
  let second = Math.floor(Math.random() * (HAPPY_EMOJI.length - 1))
  if (second >= first) second += 1
  return `${HAPPY_EMOJI[first]}${HAPPY_EMOJI[second]}`
}

/** Local-time build date/time, e.g. "2026-07-29 14:05". */
function formatBuildTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Fill every `[data-build-info]` element with the version / build stamp. */
export function renderBuildInfo() {
  const text = `v${APP_VERSION} · build ${BUILD_NUMBER} · ${formatBuildTime(BUILD_TIME)} ${randomEmoji()}`
  document.querySelectorAll<HTMLElement>('[data-build-info]').forEach((el) => {
    el.textContent = text
  })
}
