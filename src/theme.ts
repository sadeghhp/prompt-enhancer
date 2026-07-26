export type Theme = 'light' | 'dark'

const KEY = 'pe.theme'

/** Saved preference, falling back to the OS color scheme. */
export function loadTheme(): Theme {
  const saved = localStorage.getItem(KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme)
}
