export type Theme = 'light' | 'dark'

const KEY = 'pe.theme'

/**
 * Saved preference, falling back to the OS color scheme. Every access is
 * guarded: reading `localStorage` throws outright when site data is blocked,
 * and this runs inside the Alpine data factory — an exception here would
 * leave the whole page unrendered.
 */
export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* storage blocked — fall through to the OS preference */
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* storage blocked — the toggle still applies for this page view */
  }
}
