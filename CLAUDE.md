# Prompt Enhancer — project guide

Browser-only prompt-enhancement app. No backend: provider calls go straight
from the browser to the LLM API; all data lives in `localStorage`.
Stack: Vite, TypeScript, Tailwind CSS 4, Alpine.js. Two pages: `index.html`
(Enhance) and `settings.html` (providers + best practices). All markup lives
in these two HTML files; behavior in `src/*.ts`; all styling conventions in
`src/style.css`.

Commands: `npm run dev` · `npm run build` (typechecks then builds) ·
`npm test` (Vitest over the pure modules) · `npm run smoke` (builds, then
drives the real app in headless Chrome against a stub provider in
`test/e2e/` — persistence timing, chain navigation, streaming,
cancel/failure recovery and multi-tab merging; needs a Chrome binary, set
`CHROME_PATH` if it isn't found automatically).

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
| `--surface-header` | Translucent page-header bar (pairs with `backdrop-blur`) |
| `--surface-pop` | Opaque floating panels (advanced-settings overlay) |
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
decoration — selection markers (e.g. the default-model ★ in Settings) use
the accent, not amber/gold.

### Typography scale

System font stack (Tailwind default), antialiased. Four sizes only — never
arbitrary sizes like `text-[11px]`:

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
`--shadow-pop` on floating overlays (`.advanced-panel`). No other shadows,
no glows.

### Component classes (defined in `src/style.css`)

- `.card` / `.card-inset` — panel and nested-panel chrome.
- `.field` (+ `.field-xs`) — every input/select/textarea. Focus state =
  accent border + 3px `--accent-ring` box-shadow. `.field-label` above it.
- `.btn-icon` — icon-only row controls (star/pin/archive/rename/delete):
  real `<button type="button">`s with a focus ring. Rows reveal them with
  `hidden group-hover:inline-flex group-focus-within:inline-flex`, so they
  take no width (and don't truncate the title) until hover or focus.
- `.btn` + one variant + optional `.btn-xs`:
  - `.btn-primary` — the main action per view (Enhance, Add, Apply)
  - `.btn-soft` — secondary accent actions (Test, Fetch, active nav pill)
  - `.btn-outline` — neutral actions (Copy, arrows, Retry)
  - `.btn-ghost` — low-emphasis (Cancel, Close, nav links, theme toggle)
  - `.btn-danger-ghost` — destructive (Remove, ✕)
- `.checkbox` — accent-colored checkboxes.

Component states are built into the classes: hover via `:hover:not(:disabled)`,
disabled = `opacity: 0.4` + `cursor: not-allowed` (buttons **and** fields),
keyboard focus via `:focus-visible` accent ring (buttons, checkboxes) or
`:focus` (fields). Don't re-implement states with utilities. Scrollbars are
globally thin and token-colored (`scrollbar-color: var(--border-strong)`).
Soft-tinted notices (warning/error strips) use `--radius-md`.

### Prompt-version display

Every chain column header leads with a `.version-badge`: a solid-accent
rounded block showing a small `v` prefix (`.version-prefix`) and a large bold
number = the column's 1-based position in the chain. Rules:

- The badge is the visual anchor of the column header — keep it first, left.
- `min-width` + padding + `tabular-nums` make 1-, 2-, and 3-digit versions
  render at identical style; never truncate it.
- Lineage is stated next to the badge: column 0 reads "Original prompt /
  written by you"; column *i* reads "Enhanced from v*i* / by {provider/model}".
  The source version ("v*i*") is rendered in `--accent-text` + `tabular-nums`
  so it visually echoes the badge and links consecutive versions.
- Version numbers appear consistently everywhere the chain is referenced:
  the Enhance button ("Enhance → v{next}"), the chain nav's version pills
  (`.chain-pills`, one `v{n}` pill per link; `.btn-soft` for the columns in
  view, `.btn-ghost` otherwise — clicking one calls `goToView`), and the
  preview header ("v{n} · {words}").
- Every editor header and the preview header carry a length readout from
  `describeLength` (`src/text.ts`): words · chars, plus the word-count
  change against the previous link for enhanced columns.

### Responsive layout

- `html`/`body` are `overflow-x: clip` — the page never scrolls
  horizontally. All horizontal motion happens inside the chain viewport
  (`overflow-clip`, `min-w-0`) via transform, so the header never shifts.
- App frame grid lives in `.app-layout` (style.css): below `md` everything
  stacks (the sidebar caps at `max-h-48` and scrolls); from `md` the sidebar
  gets its own track and the Markdown preview is a full-width strip under
  the chain; from `xl` the preview is the third track.
- Sidebar and preview widths are resizable: `--sidebar-width` /
  `--preview-width` default to CSS `clamp()`s and are overridden inline from
  `layout` state in `main.ts` (`layoutStyle`). Each pane carries a
  `.resize-handle` (`role="separator"`) in the grid gap beside it: pointer
  drag, ←/→ (Shift ×4), Home/End, Enter or double-click to reset. Widths
  are stored in px under `pe.layout` (`storage.loadLayout/saveLayout`),
  validated by `normalizeLayout`, and re-fitted on window resize by
  `fitLayout()` in `main.ts` (which measures the frame and calls the pure
  `fitPanes`) so the chain viewport never drops below `CHAIN_MIN`
  (`src/layout.ts` holds all the pure arithmetic). `PREVIEW_COLUMN_QUERY` /
  `SIDEBAR_COLUMN_QUERY` in `main.ts` mirror the `.app-layout` breakpoints
  — change the CSS and the JS together. The preview can also be hidden
  (`layout.previewCollapsed`, "Hide" in its header / "Show preview" in the
  chain nav): `.app-layout-no-preview` gives the chain the track back.
- `.chain-editor-group` has `min-height: fit-content`, so on short
  viewports the column scrolls instead of the Enhance button overlapping
  the instruction card.
- Chain: `.chain-track` slides horizontally by `--view-index` (set inline by
  Alpine) × `--chain-step`. Default `--chain-step: 50%` (two columns: a
  version and its enhancement side by side); from `1800px` it is `33.333%`
  (three columns); below `lg` it is `94%` (one column + a peek of the next).
  Widths live in CSS only, but `visibleColumnCount()` in `main.ts` mirrors
  the same two breakpoints via `matchMedia` to clamp `viewIndex` — change
  the CSS and the JS together. `interactiveColumnCount()` adds the narrow
  peek column, since it is on screen and tapping it must select it; columns
  outside *that* window are `inert` (the viewport is `overflow: clip`, so
  focus landing on a clipped column can never be scrolled into view).
  `←`/`→` arrow keys also slide the chain (listener in `main.ts`, skipped
  when the event target is a field, a resize handle, or anything else that
  uses arrow keys itself).
- Only a window of columns is mounted (`isMounted`: the reachable window
  plus one either side); the rest keep an empty `.chain-slot` so widths and
  positions still hold. A card is ~70 directives, and the advanced panel's
  body is behind a further `x-if` — mounting every link's selects made
  switching sessions visibly slow. Column state lives in the data, so
  unmounting costs nothing but scroll position.
- `.chain-card` scrolls vertically at every width (`overflow-y: auto`,
  children `flex-shrink: 0`, editor min-height via `.chain-editor`) so no
  control is ever clipped and the page itself needs no vertical scrolling.
- Each `.chain-card` is an `@container`: per-column form grids use container
  variants (`grid-cols-2 @lg:grid-cols-3`) so density tracks the column's
  own width, not the viewport. Advanced settings use `.field-xs` fields.
- Advanced settings open as an in-column overlay (`.advanced-panel`,
  `--surface-pop` + `--shadow-pop`) over the editor + instruction area —
  never in-flow, so opening them displaces nothing; the Enhance button
  stays visible below the panel and the panel body scrolls internally.
- The per-column Enhance button is `min-w-1/3`, right-aligned in its column
  — a fixed third truncated its "Enhance → v12" label in a narrow column.
- Nothing may overflow the viewport horizontally except the chain track
  itself.

## Conventions

- Keep business logic out of templates beyond Alpine bindings; state lives in
  `src/main.ts` / `src/settings-page.ts`.
- `persist()` after every user-visible state change. It is debounced
  (250 ms trailing, flushed on `pagehide`, window blur and tab hide) because
  serializing every session per keystroke was the main source of typing lag;
  use `persistNow()` only for structural changes (create/open/delete/archive/
  pin/star). Both go through `flushPersist()`, which writes only when
  something is pending and leaves the data pending if the write failed, so
  the next flush retries. Pass raw objects (`Alpine.raw`) to `storage.*`,
  never reactive proxies. Every `storage.save*` returns a boolean — surface
  `false` via `storageError`.
- Panel open/closed state is view state, not data: `openAdvanced` /
  `openReasoning` are keyed by column id and never persisted, so toggling a
  panel costs no write and nothing reopens itself after a reload.
- Only one enhancement runs at a time (`enhancing: EnhanceRun | null`); it
  is always cancellable (`cancelEnhance()`) and times out on its own
  (connect and idle deadlines in `api.ts`), and a failed or cancelled run
  restores the chain — including the links it had replaced — exactly as it
  was. Streamed chunks are buffered and applied once per animation frame.
- Stored data is never trusted. `migrateColumn`/`migrateSession` check every
  field and repair what they can; a record too damaged to use makes
  `migrateSession` throw, and `migrateAll` sets just that record aside so one
  bad entry can't fail the whole boot. Extend them when the schema changes.
- Nothing unreadable is ever overwritten: `storage.quarantine()` parks it
  under `pe.sessions.quarantine`, `backupSessionsOnce()` holds a copy of the
  previous version's blob for a week (skipped when it would eat too much of
  the ~5 MB quota), and both surface through the dismissible `dataNotice`.
- Two tabs share one origin's storage: a `storage` event merges the other
  tab's sessions by `updatedAt` (this tab's unsaved edits to the open session
  win), and deletes travel as tombstones under `pe.deleted` so a stale tab
  can't write a deleted session back. `pe.activeSession` is deliberately not
  adopted — each tab keeps what its user opened.
- Session titles follow the first line of the original prompt until the
  user renames one inline (sidebar pencil / double-click); `customTitle`
  then pins it. The sidebar search (`sessionQuery`) matches titles and
  prompt text.
- Export/Import (sidebar footer) moves sessions only — never providers or
  API keys — through `src/transfer.ts`; imports with a known id replace
  that session, others are appended, and everything goes through
  `migrateSession`.
- Ctrl/⌘+Enter in a column's prompt or instruction editor enhances from
  that column (`enhanceShortcut`).
