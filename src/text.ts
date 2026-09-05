/** Small pure helpers for the length readouts shown next to prompts. */

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function plural(n: number, unit: string): string {
  return `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`
}

/**
 * "142 words · 812 chars", plus the change against `previous` when given
 * and non-empty ("(−18% words)") so Brevity / Token efficiency results are
 * visible at a glance. Empty text reads "empty".
 */
export function describeLength(text: string, previous?: string): string {
  const words = wordCount(text)
  if (words === 0) return 'empty'
  let out = `${plural(words, 'word')} · ${plural(text.length, 'char')}`
  if (previous !== undefined) {
    const before = wordCount(previous)
    if (before > 0) {
      const pct = Math.round(((words - before) / before) * 100)
      const sign = pct > 0 ? '+' : pct < 0 ? '−' : '±'
      out += ` (${sign}${Math.abs(pct)}% words)`
    }
  }
  return out
}
