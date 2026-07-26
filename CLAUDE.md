# Prompt Enhancer — project guide

Browser-only prompt-enhancement app. No backend: provider calls go straight
from the browser to the LLM API; all data lives in `localStorage`.
Stack: Vite, TypeScript, Tailwind CSS 4, Alpine.js. Two pages: `index.html`
(Enhance) and `settings.html` (providers + best practices). All markup lives
in these two HTML files; behavior in `src/*.ts`; all styling conventions in
`src/style.css`.

Commands: `npm run dev` · `npm run build` (typechecks then builds).

## Design system

All visual styling flows through semantic CSS custom properties defined in
`src/style.css` (`:root` for light, `.dark` overrides for dark). Templates
consume them either via component classes (`.btn`, `.field`, `.card`, …) or
Tailwind v4 var shorthand (`bg-(--surface-page)`, `border-(--border-default)`).
**Never hard-code a slate/indigo utility in templates for surfaces, borders,
text, or accents — use the tokens.** Dark mode is toggled via the `dark` class
on `<html>` (see `@custom-variant dark` in style.css), not the OS setting.

### Color tokens

| Token | Role |
|---|---|
| `--surface-page` | App background |
| `--surface-card` | Panels / cards |
| `--surface-inset` | Nested panels inside cards (`.card-inset`) |
| `--surface-field` | Inputs, selects, textareas |
| `--surface-hover` | Hover fill for ghost/outline controls and list rows |
| `--border-default` | Card borders, dividers |
| `--border-strong` | Field borders, outline buttons, dashed empty states |
| `--text-primary` | Headings, titles, field values |
| `--text-secondary` | Body text, labels-in-context |
| `--text-muted` | Secondary metadata, field labels |
| `--text-faint` | Placeholders, hints, "(optional)" |
| `--accent`, `--accent-hover` | Primary actions, version badge (indigo) |
| `--accent-soft`, `--accent-soft-hover` | Tinted fills (active nav, soft buttons, selected session) |
| `--accent-text` | Accent-colored text on soft fills |
| `--accent-ring` | Focus rings and active outlines |
| `--danger`, `--danger-soft` | Destructive actions, errors |
| `--success` / `--warning`, `--warning-soft` | Test-status / notice text |

One accent only (indigo). Status colors are reserved for status, never
decoration.

### Typography scale

System font stack (Tailwind default), antialiased. Four sizes only:

- `text-base` semibold — app title
- `text-lg` semibold `--text-primary` — page headings (Settings)
- `text-sm` — all body text, buttons, fields; semibold + `--text-primary` for
  panel/section titles
- `text-xs` — metadata, field labels, hints, small buttons

Numbers that get compared (versions, counts) use `tabular-nums`.

### Spacing scale

Tailwind spacing only, in a tight rhythm: gaps between sibling cards `gap-3`
/ `space-y-*` of 2–4; card padding `px-4 py-2.5` (headers/rows) or `p-5`
(settings sections); form grids `gap-3`; checkbox groups `gap-x-4 gap-y-2`.
Page gutters `p-4` (app frame) / `p-6` (settings, `sm:`+).

### Border radius

Three radii, via tokens — pick by component size, never arbitrary values:

- `--radius-sm` (0.5rem): inputs, selects, buttons
- `--radius-md` (0.75rem): badges, list rows, inset panels, large CTA buttons
- `--radius-lg` (1rem): cards / top-level panels

### Shadows

Understated only: `--shadow-card` on `.card` and the version badge;
`--shadow-pop` reserved for future overlays. No other shadows, no glows.

### Component classes (defined in `src/style.css`)

- `.card` / `.card-inset` — panel and nested-panel chrome.
- `.field` (+ `.field-xs`) — every input/select/textarea. Focus state =
  accent border + 3px `--accent-ring` box-shadow. `.field-label` above it.
- `.btn` + one variant + optional `.btn-xs`:
  - `.btn-primary` — the main action per view (Enhance, Add, Apply)
  - `.btn-soft` — secondary accent actions (Test, Fetch, active nav pill)
  - `.btn-outline` — neutral actions (Copy, arrows, Retry)
  - `.btn-ghost` — low-emphasis (Cancel, Close, nav links, theme toggle)
  - `.btn-danger-ghost` — destructive (Remove, ✕)
- `.checkbox` — accent-colored checkboxes.

Component states are built into the classes: hover via `:hover:not(:disabled)`,
disabled = `opacity: 0.4` + `cursor: not-allowed`, keyboard focus via
`:focus-visible` accent ring. Don't re-implement states with utilities.

### Prompt-version display

Every chain column header leads with a `.version-badge`: a solid-accent
rounded block showing a small `v` prefix (`.version-prefix`) and a large bold
number = the column's 1-based position in the chain. Rules:

- The badge is the visual anchor of the column header — keep it first, left.
- `min-width` + padding + `tabular-nums` make 1-, 2-, and 3-digit versions
  render at identical style; never truncate it.
- Lineage is stated next to the badge: column 0 reads "Original prompt /
  written by you"; column *i* reads "Enhanced from v*i* / by {provider/model}".
- Version numbers appear consistently everywhere the chain is referenced:
  the Enhance button ("Enhance → v{next}") and the nav counter
  ("Showing v1–v2 of N links").

### Responsive layout

- Desktop (`md:`+): `[16rem_1fr]` grid — sessions sidebar + chain viewport.
  Below `md`, single column; the sidebar caps at `max-h-48` and scrolls.
- Chain: `.chain-track` slides horizontally by `--view-index` (set inline by
  Alpine) × `--chain-step`. Desktop `--chain-step: 50%` (two columns
  visible); below `lg` it is `94%` (one column + a peek of the next). Change
  step sizes in CSS only — the JS never encodes widths.
- Below `lg`, `.chain-card` scrolls vertically (`overflow-y: auto`, children
  `flex-shrink: 0`, editor min-height via `.chain-editor`) so no control is
  ever clipped.
- Form grids collapse: `grid-cols-1 sm:grid-cols-2/3`. Nothing may overflow
  the viewport horizontally except the chain track itself.

## Conventions

- Keep business logic out of templates beyond Alpine bindings; state lives in
  `src/main.ts` / `src/settings-page.ts`.
- `persist()` after every user-visible state change.
- Session migration for older stored shapes happens in `migrateSession` —
  extend it when the stored schema changes.
