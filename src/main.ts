import Alpine from 'alpinejs'
import { EnhanceCancelledError, enhancePrompt } from './api'
import { renderBuildInfo } from './build-info'
import type { AppliedBestPractice } from './api'
import {
  KEY_STEP,
  LAYOUT_GAP,
  PANE_LIMITS,
  clampPaneWidth,
  fitPanes,
  widthAfterDrag,
} from './layout'
import type { LayoutState, PaneId } from './layout'
import { renderMarkdown } from './markdown'
import { KEYS, STORAGE_ERROR_MESSAGE, storage } from './storage'
import { describeLength, wordCount } from './text'
import { applyTheme, loadTheme, saveTheme } from './theme'
import { exportFileName, mergeSessions, parseSessionsFile, serializeSessions } from './transfer'
import { clampView as clampViewPure, viewIndexAfterEnhance } from './view'
import {
  DEFAULT_OPTIONS,
  OUTPUT_FORMATS,
  TARGET_PLATFORMS,
  TARGET_TYPES,
  capReasoning,
  defaultTarget,
  titleFromPrompt,
  uid,
} from './types'
import type {
  BestPracticeCollection,
  ColumnSettings,
  DefaultSettings,
  EnhanceOptions,
  PromptColumn,
  Provider,
  Session,
} from './types'

/**
 * The user's default enhancement settings, read once. Parsing them per column
 * during migration is measurable on long chains; the storage listener drops
 * the cache when another tab saves new defaults.
 */
let cachedDefaults: DefaultSettings | null = null
function appDefaults(): DefaultSettings {
  return (cachedDefaults ??= storage.loadDefaults())
}

/** The provider's configured default model, falling back to its first model. */
function defaultModelFor(provider: Provider | undefined) {
  if (!provider) return undefined
  return provider.models.find((m) => m.id === provider.defaultModelId) ?? provider.models[0]
}

function defaultSettings(providers: Provider[]): ColumnSettings {
  const provider = providers[0]
  const defaults = appDefaults()
  return {
    providerId: provider?.id ?? '',
    modelId: defaultModelFor(provider)?.id ?? '',
    outputLanguage: defaults.outputLanguage,
    outputFormat: defaults.outputFormat,
    options: { ...defaults.options },
    target: defaultTarget(),
  }
}

function cloneSettings(settings: ColumnSettings): ColumnSettings {
  return JSON.parse(JSON.stringify(settings)) as ColumnSettings
}

function newColumn(settings: ColumnSettings, overrides: Partial<PromptColumn> = {}): PromptColumn {
  return {
    id: uid(),
    text: '',
    instruction: '',
    settings: cloneSettings(settings),
    createdAt: Date.now(),
    producedBy: '',
    reasoning: '',
    reasoningSeconds: 0,
    ...overrides,
  }
}

function newSession(providers: Provider[]): Session {
  const now = Date.now()
  return {
    id: uid(),
    title: 'New session',
    createdAt: now,
    updatedAt: now,
    chain: [newColumn(defaultSettings(providers))],
    viewIndex: 0,
  }
}

/**
 * Bring one stored column up to the current shape. Every field is checked
 * rather than assumed: this data comes from localStorage, where a half-written
 * record or an older version's shape would otherwise throw during boot and
 * take the whole page down with it.
 */
function migrateColumn(col: PromptColumn, providers: Provider[]): void {
  if (!col || typeof col !== 'object') throw new Error('chain link is not an object')
  if (typeof col.id !== 'string' || !col.id) col.id = uid()
  if (typeof col.text !== 'string') col.text = ''
  if (typeof col.instruction !== 'string') col.instruction = ''
  if (typeof col.producedBy !== 'string') col.producedBy = ''
  col.reasoning = capReasoning(typeof col.reasoning === 'string' ? col.reasoning : '')
  if (!Number.isFinite(col.reasoningSeconds)) col.reasoningSeconds = 0
  if (!Number.isFinite(col.createdAt)) col.createdAt = Date.now()
  // Panel open/closed state is view state now; drop it from stored records.
  delete (col as unknown as Record<string, unknown>).showAdvanced
  delete (col as unknown as Record<string, unknown>).showReasoning

  if (!col.settings || typeof col.settings !== 'object') col.settings = defaultSettings(providers)
  const s = col.settings
  if (typeof s.providerId !== 'string') s.providerId = ''
  if (typeof s.modelId !== 'string') s.modelId = ''
  if (typeof s.outputLanguage !== 'string') s.outputLanguage = appDefaults().outputLanguage
  if (!OUTPUT_FORMATS.some((f) => f.value === s.outputFormat)) {
    s.outputFormat = appDefaults().outputFormat
  }
  if (!s.options || typeof s.options !== 'object') s.options = { ...appDefaults().options }
  const options = s.options
  for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof EnhanceOptions)[]) {
    if (typeof options[key] !== 'boolean') options[key] = DEFAULT_OPTIONS[key]
  }
  if (!s.target || typeof s.target !== 'object') s.target = defaultTarget()
  const target = s.target
  if (typeof target.platform !== 'string') target.platform = ''
  if (typeof target.model !== 'string') target.model = ''
  if (typeof target.type !== 'string') target.type = ''
  target.bestPracticeIds = Array.isArray(target.bestPracticeIds)
    ? target.bestPracticeIds.filter((id): id is string => typeof id === 'string')
    : []
}

/**
 * Bring one stored session up to the current shape, including the pre-chain
 * draft/versions model. Throws only when the record is too damaged to use, so
 * the caller can set that one session aside instead of failing the whole boot.
 */
function migrateSession(s: Session, providers: Provider[]): void {
  if (!s || typeof s !== 'object') throw new Error('session is not an object')
  if (typeof s.id !== 'string' || !s.id) s.id = uid()
  if (typeof s.title !== 'string' || !s.title) s.title = 'New session'
  if (!Number.isFinite(s.createdAt)) s.createdAt = Date.now()
  if (!Number.isFinite(s.updatedAt)) s.updatedAt = s.createdAt
  s.starred = s.starred === true
  s.pinned = s.pinned === true
  s.archived = s.archived === true
  s.customTitle = s.customTitle === true

  if (Array.isArray(s.chain) && s.chain.length > 0) {
    s.chain = s.chain.filter((c) => Boolean(c) && typeof c === 'object')
    for (const col of s.chain) migrateColumn(col, providers)
  }
  if (Array.isArray(s.chain) && s.chain.length > 0) {
    s.viewIndex = clampView(Number.isFinite(s.viewIndex) ? s.viewIndex : 0, s.chain.length)
  } else {
    // Pre-chain shape: one draft plus a list of enhanced versions.
    const legacy =
      s.settings && typeof s.settings === 'object' ? s.settings : defaultSettings(providers)
    const chain: PromptColumn[] = [
      newColumn(legacy, {
        text: typeof s.draft === 'string' ? s.draft : '',
        instruction: typeof s.instruction === 'string' ? s.instruction : '',
        createdAt: s.createdAt,
      }),
    ]
    for (const v of Array.isArray(s.versions) ? s.versions : []) {
      if (!v || typeof v !== 'object' || typeof v.text !== 'string') continue
      chain.push(
        newColumn(legacy, {
          id: typeof v.id === 'string' && v.id ? v.id : uid(),
          text: v.text,
          createdAt: Number.isFinite(v.createdAt) ? v.createdAt : s.createdAt,
          producedBy: typeof v.model === 'string' ? v.model : '',
        }),
      )
    }
    for (const col of chain) migrateColumn(col, providers)
    s.chain = chain
    s.viewIndex = clampView(chain.length - 1, chain.length)
  }
  delete s.draft
  delete s.instruction
  delete s.versions
  delete s.settings
}

/**
 * Migrate a stored list, setting aside records that cannot be read instead of
 * letting one bad entry throw and leave the app with no sessions at all.
 */
function migrateAll(
  stored: Session[],
  providers: Provider[],
): { sessions: Session[]; rejected: unknown[] } {
  const sessions: Session[] = []
  const rejected: unknown[] = []
  for (const entry of stored) {
    try {
      migrateSession(entry, providers)
      sessions.push(entry)
    } catch (err) {
      console.warn('Skipping an unreadable session:', err, entry)
      rejected.push(entry)
    }
  }
  return { sessions, rejected }
}

/*
 * How many chain columns the viewport shows at once. Mirrors the
 * `--chain-step` breakpoints in style.css (94% below lg, 50% by default,
 * 33.333% from 1800px) — change both together. The JS needs the count only
 * to clamp `viewIndex`; widths themselves stay in CSS.
 */
const WIDE_QUERY = matchMedia('(min-width: 1800px)')
const NARROW_QUERY = matchMedia('(max-width: 1023px)')

function visibleColumnCount(): number {
  if (WIDE_QUERY.matches) return 3
  if (NARROW_QUERY.matches) return 1
  return 2
}

/**
 * Columns the user can actually reach. Below `lg` the step is 94%, so the
 * next link peeks in at the right edge: it is on screen and tapping it should
 * select it, which means it must not be `inert` even though the viewIndex
 * clamp counts only whole columns.
 */
function interactiveColumnCount(): number {
  return visibleColumnCount() + (NARROW_QUERY.matches ? 1 : 0)
}

/*
 * From xl the Markdown preview is the third grid track and shares its row
 * with the sidebar; below that it is a strip under the chain. Mirrors the
 * `.app-layout` breakpoint in style.css — change both together. Used only to
 * know which panes compete for the same row when clamping a resize.
 */
const PREVIEW_COLUMN_QUERY = matchMedia('(min-width: 1280px)')
/** From md the sidebar has its own track; below, panes stack and widths don't apply. */
const SIDEBAR_COLUMN_QUERY = matchMedia('(min-width: 768px)')

/** `clampViewPure` with the live column count; see view.ts for the rule. */
function clampView(index: number, chainLength: number, visible = visibleColumnCount()): number {
  return clampViewPure(index, chainLength, visible)
}

/** Identifies the single enhancement allowed to run at a time. */
interface EnhanceRun {
  sessionId: string
  /** Column whose Enhance button was pressed (shows the spinner) */
  sourceId: string
  /** Column being streamed into (shows the Cancel button) */
  targetId: string
}

/** Delay before keystroke-driven changes are written to localStorage. */
const PERSIST_DEBOUNCE_MS = 250
/** Delay before the Markdown preview re-renders while its text is changing. */
const PREVIEW_DEBOUNCE_MS = 150
/**
 * Longest the preview may lag behind the text it shows. A plain trailing
 * debounce is starved by a stream: chunks are applied once per animation frame,
 * so the timer was cleared and re-armed roughly ten times per delay and never
 * fired until the response ended. This caps the wait so the pane keeps up.
 */
const PREVIEW_MAX_WAIT_MS = 400

// Non-reactive bookkeeping. Kept out of the Alpine component on purpose:
// writes to these must not trigger effects, and the preview effect below
// must not observe its own scheduling state.
let activeController: AbortController | null = null
let persistTimer: ReturnType<typeof setTimeout> | undefined
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewKey = ''
/** When the preview last actually parsed, for the max-wait cap above. */
let previewRenderedAt = 0
/** Whether anything is waiting to be written; cleared by a successful flush. */
let dirty = false
/** Session whose `updatedAt` is bumped on the next persist flush. */
let touchedSession: Session | null = null
/**
 * Trigger button of each open advanced panel, so focus can return to it on
 * close. Kept outside the component: it holds DOM nodes, which must never be
 * made reactive or persisted.
 */
const advancedTriggers = new Map<string, HTMLElement>()

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

Alpine.data('mainApp', () => ({
  providers: [] as Provider[],
  sessions: [] as Session[],
  bestPractices: [] as BestPracticeCollection[],
  targetPlatforms: TARGET_PLATFORMS,
  targetTypes: TARGET_TYPES,
  outputFormats: OUTPUT_FORMATS,
  activeId: '' as string,
  /** Whether the collapsible Archived sessions section is expanded */
  showArchived: false,
  /** Sidebar filter; matches titles and prompt text, case-insensitively */
  sessionQuery: '',
  /** Session whose title is being edited inline; empty when none */
  renamingId: '' as string,
  renameDraft: '',
  /** Transient confirmation (e.g. import summary); clears itself */
  notice: '',
  _noticeTimer: 0 as ReturnType<typeof setTimeout> | 0,
  /**
   * Links that the last successful enhancement replaced, restorable while the
   * notice is up. Enhancing an earlier column deletes every later link, and a
   * browser `confirm()` is thin cover for losing a long refinement chain.
   */
  undoReplace: null as { sessionId: string; index: number; links: PromptColumn[] } | null,
  /** The in-flight enhancement, or null when idle. One at a time, app-wide. */
  enhancing: null as EnhanceRun | null,
  /** Column id currently in the reasoning phase; empty when none */
  thinkingId: '' as string,
  /** Live elapsed seconds while `thinkingId` is set */
  thinkingSeconds: 0,
  _thinkTimer: 0 as ReturnType<typeof setInterval> | 0,
  error: '',
  /** Set when a write to localStorage fails; shown as a persistent banner */
  storageError: '',
  /** Set when stored data could not be read; dismissible, says what was kept */
  dataNotice: '',
  /** Column id shown in the Markdown preview; empty = rightmost column */
  previewId: '' as string,
  /** Rendered preview HTML, updated by the scheduler in `init` */
  previewHtml: '',
  /** Columns fully in view; drives the viewIndex clamp */
  visibleColumns: visibleColumnCount(),
  /** Columns at least partly in view; drives `inert` and mounting */
  interactiveColumns: interactiveColumnCount(),
  /** Per-column panel state, keyed by column id. View state — never persisted. */
  openAdvanced: {} as Record<string, boolean>,
  openReasoning: {} as Record<string, boolean>,
  copiedId: '' as string,
  _copiedTimer: 0 as ReturnType<typeof setTimeout> | 0,
  theme: loadTheme(),
  /** Persisted pane widths in px; `null` = the CSS default (see .app-layout) */
  layout: storage.loadLayout() as LayoutState,
  /** Pane whose handle is being dragged; empty when idle */
  resizing: '' as PaneId | '',
  paneLimits: PANE_LIMITS,

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark'
    applyTheme(this.theme)
    saveTheme(this.theme)
  },

  init() {
    // Before this version's first write, keep an untouched copy of what the
    // previous version stored.
    storage.backupSessionsOnce()
    this.providers = storage.loadProviders()
    this.bestPractices = storage.loadBestPractices()

    const stored = storage.readSessions()
    const { sessions, rejected } = migrateAll(stored.sessions, this.providers)
    this.sessions = sessions
    if (rejected.length > 0) {
      storage.quarantine('sessions failed migration', rejected)
      const plural = rejected.length === 1
      this.dataNotice = `${rejected.length} saved session${plural ? '' : 's'} could not be read and ${plural ? 'was' : 'were'} set aside under “${KEYS.quarantine}” in browser storage. Everything else opened normally.`
    }
    if (this.sessions.length === 0) {
      this.sessions.push(newSession(this.providers))
    }
    const savedActive = storage.loadActiveSession()
    this.activeId =
      savedActive && this.sessions.some((s) => s.id === savedActive)
        ? savedActive
        : this.sessions[0].id
    if (stored.corrupt) {
      // Something was saved but could not be parsed. Park a copy and leave the
      // stored value alone: writing now would destroy data the user might
      // still recover by hand.
      storage.quarantine('sessions blob was unreadable', stored.raw)
      this.dataNotice = `Your saved sessions could not be read, so this window started empty. A copy of the unreadable data was kept under “${KEYS.quarantine}” in browser storage; editing anything here replaces it.`
    } else {
      this.persistNow()
    }

    // Debounced writes must not be lost when the tab is closed, navigated
    // away from (e.g. to Settings), hidden, or merely sent to the background.
    window.addEventListener('pagehide', () => this.flushPersist())
    window.addEventListener('blur', () => this.flushPersist())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushPersist()
    })

    // Another tab writing this origin's storage. Without this, two open tabs
    // each hold their own copy and the last one to save wins.
    window.addEventListener('storage', (e) => this.onExternalStorage(e))

    // Keep the viewIndex clamp in step with the CSS column count.
    const onViewportChange = () => {
      this.visibleColumns = visibleColumnCount()
      this.interactiveColumns = interactiveColumnCount()
      const session = this.session
      session.viewIndex = clampView(session.viewIndex, session.chain.length, this.visibleColumns)
      this.persist()
    }
    WIDE_QUERY.addEventListener('change', onViewportChange)
    NARROW_QUERY.addEventListener('change', onViewportChange)

    // A pane width saved on a wider window may no longer leave the chain
    // enough room: re-clamp once the frame has laid out, and on every resize.
    this.$nextTick(() => this.fitLayout())
    let fitFrame = 0
    window.addEventListener('resize', () => {
      if (fitFrame) return
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0
        this.fitLayout()
      })
    })

    // Preview renderer: re-runs whenever the previewed column or its text
    // changes. Rendering is scheduled (not done inline) so typing and
    // streaming coalesce into one parse per pause instead of one per event.
    Alpine.effect(() => {
      const col = this.previewColumn
      this.schedulePreview(col?.id ?? '', col?.text ?? '')
    })

    // ← / → slide the chain viewport — unless the keystroke belongs to a
    // control that uses arrow keys itself (fields, the pane resize handles),
    // or to a browser shortcut (Alt+← = back).
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const el = e.target as HTMLElement | null
      if (
        el?.closest?.(
          'input, textarea, select, [contenteditable], [role="separator"], [role="slider"], [role="listbox"]',
        )
      )
        return
      e.preventDefault()
      if (e.key === 'ArrowLeft') this.prevView()
      else this.nextView()
    })
  },

  /**
   * React to another tab's write. Sessions are merged rather than replaced:
   * whichever copy was updated last wins, deletions travel as tombstones, and
   * this tab's own unsaved edits are never dropped. `pe.activeSession` is
   * deliberately not adopted — each tab keeps looking at what its user opened.
   */
  onExternalStorage(e: StorageEvent) {
    if (e.storageArea && e.storageArea !== localStorage) return
    switch (e.key) {
      case KEYS.providers:
        this.providers = storage.loadProviders()
        break
      case KEYS.bestPractices:
        this.bestPractices = storage.loadBestPractices()
        break
      case KEYS.defaults:
        cachedDefaults = null
        break
      case KEYS.layout:
        this.layout = storage.loadLayout()
        break
      case KEYS.sessions:
      case KEYS.deleted:
        this.adoptExternalSessions()
        break
      default:
        break
    }
  },

  adoptExternalSessions() {
    const stored = storage.readSessions()
    if (stored.corrupt) return
    const { sessions: remote } = migrateAll(stored.sessions, this.providers)
    const remoteById = new Map(remote.map((s) => [s.id, s]))
    const merged: Session[] = []

    for (const local of this.sessions) {
      const incoming = remoteById.get(local.id)
      remoteById.delete(local.id)
      if (!incoming) {
        // Missing there but present here: keep it. A real delete arrives as a
        // tombstone below; anything else is a session this tab just created.
        merged.push(local)
        continue
      }
      // This tab's unsaved edits to the open session outrank a remote copy.
      const holdLocal = dirty && local.id === this.activeId
      merged.push(!holdLocal && incoming.updatedAt > local.updatedAt ? incoming : local)
    }
    for (const incoming of remoteById.values()) merged.push(incoming)

    const deletedAt = new Map(storage.loadDeleted().map((t) => [t.id, t.at]))
    let next = merged.filter((s) => {
      const at = deletedAt.get(s.id)
      // Survive a remote delete only if edited after it happened.
      return at === undefined || s.updatedAt > at
    })
    if (next.length === 0) next = [newSession(this.providers)]
    this.sessions = next

    if (!this.sessions.some((s) => s.id === this.activeId)) {
      this.activeId = this.sessions[0].id
      this.previewId = ''
    }
    const session = this.session
    session.viewIndex = clampView(session.viewIndex, session.chain.length, this.visibleColumns)
    // No write here: this tab has nothing new to contribute, and writing back
    // would bounce the same update out to every other tab.
  },

  get session(): Session {
    return this.sessions.find((s) => s.id === this.activeId) ?? this.sessions[0]
  },

  /** Pinned sessions float to the top; the rest fall in recency order. */
  sortSessions(list: Session[]): Session[] {
    return [...list].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  },

  matchesQuery(s: Session): boolean {
    const q = this.sessionQuery.trim().toLowerCase()
    if (!q) return true
    return (
      s.title.toLowerCase().includes(q) ||
      s.chain.some((c) => c.text.toLowerCase().includes(q))
    )
  },

  get visibleSessions(): Session[] {
    return this.sortSessions(this.sessions.filter((s) => !s.archived && this.matchesQuery(s)))
  },

  get archivedSessions(): Session[] {
    return this.sortSessions(this.sessions.filter((s) => s.archived && this.matchesQuery(s)))
  },

  /** Whether chain column `i` is inside the viewport's visible window. */
  isVisibleColumn(i: number): boolean {
    const from = this.session.viewIndex
    return i >= from && i < from + this.visibleColumns
  },

  /**
   * Keep the leading visible column's pill inside the nav strip. The strip
   * scrolls on long chains and hides its scrollbar, so without this the current
   * position simply disappears off the left. Scrolls only the strip — never
   * `scrollIntoView`, which would also move ancestors.
   */
  scrollPillIntoView(index: number) {
    this.$nextTick(() => {
      const strip = this.$refs.pills as HTMLElement | undefined
      // Query the buttons, not `children`: x-for leaves its own <template> as
      // the strip's first element child, which would shift every index by one.
      const pill = strip?.querySelectorAll('button')[index]
      if (!strip || !pill) return
      const left = pill.offsetLeft - strip.offsetLeft
      const right = left + pill.offsetWidth
      if (left < strip.scrollLeft) strip.scrollLeft = left - 4
      else if (right > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = right - strip.clientWidth + 4
      }
    })
  },

  /** Slide so column `i` is in view and show it in the preview (version pills). */
  goToView(i: number) {
    const session = this.session
    const col = session.chain[i]
    if (!col) return
    session.viewIndex = clampView(i, session.chain.length, this.visibleColumns)
    this.previewId = col.id
    this.persist()
  },

  /**
   * "142 words · 812 chars", with the change against the previous link. The
   * comparison is withheld while this column is being streamed into: measuring
   * a quarter-written response against a finished one reports "−92% words" and
   * races upward for the whole stream.
   */
  lengthSummary(col: PromptColumn, i: number): string {
    const streaming = this.enhancing?.targetId === col.id
    const previous = !streaming && i > 0 ? this.session.chain[i - 1]?.text : undefined
    return describeLength(col.text, previous)
  },

  get previewLength(): string {
    return describeLength(this.previewColumn.text)
  },

  /** Short form for the preview header, where width is scarce. */
  get previewWords(): string {
    const n = wordCount(this.previewColumn.text)
    return `${n.toLocaleString()} word${n === 1 ? '' : 's'}`
  },

  showNotice(text: string, ms = 5000) {
    this.notice = text
    clearTimeout(this._noticeTimer)
    this._noticeTimer = setTimeout(() => {
      this.notice = ''
      this.undoReplace = null
    }, ms)
  },

  /**
   * Put back the links the last enhancement replaced, dropping the link it
   * produced. Offered from the notice strip for as long as that notice is up.
   */
  restoreReplaced() {
    const undo = this.undoReplace
    this.undoReplace = null
    this.notice = ''
    if (!undo) return
    const session = this.sessions.find((s) => s.id === undo.sessionId)
    if (!session) return
    session.chain.splice(undo.index + 1, session.chain.length, ...undo.links)
    session.viewIndex = clampView(undo.index, session.chain.length, this.visibleColumns)
    this.previewId = ''
    this.persistNow()
  },

  /** Highest allowed viewIndex: the last `visibleColumns` links fill the viewport. */
  get maxViewIndex(): number {
    return Math.max(0, this.session.chain.length - this.visibleColumns)
  },

  /**
   * Whether column `i` is rendered: the reachable window plus one column on
   * each side, so a slide in either direction reveals an already-mounted
   * card and the column that mounts/unmounts is always off-screen.
   */
  isMounted(i: number): boolean {
    return i >= this.session.viewIndex - 1 && i <= this.session.viewIndex + this.interactiveColumns
  },

  /**
   * Whether column `i` is off screen entirely, and so must leave the tab
   * order: the viewport uses `overflow: clip`, and focus landing on a clipped
   * column cannot be scrolled into view.
   */
  isOutOfView(i: number): boolean {
    return i < this.session.viewIndex || i >= this.session.viewIndex + this.interactiveColumns
  },

  advancedOpen(col: PromptColumn): boolean {
    return this.openAdvanced[col.id] === true
  },

  reasoningOpen(col: PromptColumn): boolean {
    return this.openReasoning[col.id] === true
  },

  /**
   * Column shown in the Markdown preview pane. With nothing selected — or when
   * the selection is gone, e.g. after re-enhancing replaced later links — it
   * follows the last column in view rather than the last column in the chain,
   * so the pane always shows something the user can actually see beside it.
   * During an enhancement that is the link being streamed into, because
   * `enhanceFrom` slides the new link into the last visible slot.
   */
  get previewColumn(): PromptColumn {
    const chain = this.session.chain
    const picked = chain.find((c) => c.id === this.previewId)
    if (picked) return picked
    const last = this.session.viewIndex + this.visibleColumns - 1
    return chain[Math.max(0, Math.min(last, chain.length - 1))]
  },

  /** 1-based version number of the previewed column, for the pane header. */
  get previewVersion(): number {
    return this.session.chain.indexOf(this.previewColumn) + 1
  },

  /**
   * Render immediately when the previewed column changes or empties (cheap,
   * and the user expects the pane to follow a click at once); otherwise wait
   * for a pause in the edits/stream before parsing the whole text again —
   * but never longer than `PREVIEW_MAX_WAIT_MS`, so text that keeps arriving
   * (a stream, or continuous typing) can't starve the debounce indefinitely.
   */
  schedulePreview(id: string, text: string) {
    clearTimeout(previewTimer)
    const render = () => {
      previewTimer = undefined
      previewKey = id
      previewRenderedAt = Date.now()
      this.previewHtml = text.trim() ? renderMarkdown(text) : ''
    }
    if (id !== previewKey || !text.trim()) return render()
    const waited = Date.now() - previewRenderedAt
    if (waited >= PREVIEW_MAX_WAIT_MS) return render()
    previewTimer = setTimeout(render, Math.min(PREVIEW_DEBOUNCE_MS, PREVIEW_MAX_WAIT_MS - waited))
  },

  selectPreview(col: PromptColumn) {
    this.previewId = col.id
  },

  /* ---- Resizable panes (sessions sidebar, Markdown preview) ------------- */

  /** Inline custom properties for `.app-layout`; empty = CSS defaults. */
  get layoutStyle(): string {
    const parts: string[] = []
    if (this.layout.sidebar) parts.push(`--sidebar-width: ${this.layout.sidebar}px`)
    if (this.layout.preview) parts.push(`--preview-width: ${this.layout.preview}px`)
    return parts.join('; ')
  },

  /** Current width of a pane: the stored value, else what the CSS rendered. */
  paneWidth(pane: PaneId): number {
    const stored = this.layout[pane]
    if (stored) return stored
    const el = this.$refs[pane === 'sidebar' ? 'sidebarPane' : 'previewPane'] as
      | HTMLElement
      | undefined
    return Math.round(el?.getBoundingClientRect().width ?? PANE_LIMITS[pane].min)
  },

  /**
   * Clamp `width` for `pane` against the frame's content width and whatever
   * else shares its row: from xl both panes flank the chain; below that the
   * preview sits under the chain and only the sidebar competes with it.
   */
  clampPane(pane: PaneId, width: number): number {
    const frame = this.$refs.layout as HTMLElement | undefined
    const container = (frame?.clientWidth ?? window.innerWidth) - 2 * LAYOUT_GAP
    const other: PaneId = pane === 'sidebar' ? 'preview' : 'sidebar'
    const otherWidth = this.panesInRow().includes(other) ? this.paneWidth(other) : 0
    return clampPaneWidth(pane, width, container, otherWidth)
  },

  /** Panes that currently share the chain's row and compete for its width. */
  panesInRow(): PaneId[] {
    return PREVIEW_COLUMN_QUERY.matches && !this.layout.previewCollapsed
      ? ['sidebar', 'preview']
      : ['sidebar']
  },

  togglePreview() {
    this.layout.previewCollapsed = !this.layout.previewCollapsed
    this.saveLayout()
  },

  setPaneWidth(pane: PaneId, width: number) {
    const next = this.clampPane(pane, width)
    if (this.layout[pane] !== next) this.layout[pane] = next
  },

  /**
   * Re-fit stored widths after the frame changes size (see `fitPanes`);
   * saves if anything moved. Skipped while the panes are stacked, so a
   * visit on a phone never rewrites the desktop layout.
   */
  fitLayout() {
    if (!SIDEBAR_COLUMN_QUERY.matches) return
    const frame = this.$refs.layout as HTMLElement | undefined
    const container = (frame?.clientWidth ?? window.innerWidth) - 2 * LAYOUT_GAP
    const next = fitPanes(
      Alpine.raw(this.layout),
      { sidebar: this.paneWidth('sidebar'), preview: this.paneWidth('preview') },
      container,
      this.panesInRow(),
    )
    let changed = false
    for (const pane of ['sidebar', 'preview'] as const) {
      if (next[pane] !== this.layout[pane]) {
        this.layout[pane] = next[pane]
        changed = true
      }
    }
    if (changed) this.saveLayout()
  },

  saveLayout() {
    if (!storage.saveLayout(Alpine.raw(this.layout))) this.storageError = STORAGE_ERROR_MESSAGE
  },

  /**
   * Pointer drag on a handle. The handle captures the pointer so the drag
   * keeps tracking when the cursor outruns the 1rem hit area; widths update
   * live through `layoutStyle`, and the result is saved once on release.
   */
  startResize(pane: PaneId, e: PointerEvent) {
    if (e.button !== 0 || this.resizing) return
    const handle = e.currentTarget as HTMLElement
    const startX = e.clientX
    const startWidth = this.paneWidth(pane)
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    this.resizing = pane
    document.body.classList.add('is-resizing')
    const onMove = (ev: PointerEvent) => {
      this.setPaneWidth(pane, widthAfterDrag(pane, startWidth, ev.clientX - startX))
    }
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
      document.body.classList.remove('is-resizing')
      this.resizing = ''
      this.saveLayout()
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  },

  /**
   * Keyboard resizing on a focused handle: ←/→ nudge it (Shift = ×4),
   * Home/End jump to the narrowest/widest allowed, Enter/Backspace reset.
   * Handled keys stop here so the chain's ←/→ listener doesn't also slide.
   */
  resizeKey(pane: PaneId, e: KeyboardEvent) {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP
    let width: number
    switch (e.key) {
      case 'ArrowLeft':
        width = widthAfterDrag(pane, this.paneWidth(pane), -step)
        break
      case 'ArrowRight':
        width = widthAfterDrag(pane, this.paneWidth(pane), step)
        break
      case 'Home':
        width = PANE_LIMITS[pane].min
        break
      case 'End':
        width = PANE_LIMITS[pane].max
        break
      case 'Enter':
      case 'Backspace':
        e.preventDefault()
        this.resetPane(pane)
        return
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    this.setPaneWidth(pane, width)
    this.saveLayout()
  },

  /** Back to the CSS default width (double-click or Enter on the handle). */
  resetPane(pane: PaneId) {
    if (this.layout[pane] === null) return
    this.layout[pane] = null
    this.saveLayout()
  },

  /**
   * Debounced save for keystroke-driven and navigation changes. Serializing
   * every session on each input event was the app's biggest source of
   * typing lag; a trailing delay coalesces a burst into one write. Use
   * `persistNow()` for structural changes the user expects to be durable at
   * once (create/open/delete/archive).
   */
  persist() {
    dirty = true
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => this.flushPersist(), PERSIST_DEBOUNCE_MS)
  },

  /** Save straight away (create / open / delete / archive / pin / star). */
  persistNow() {
    dirty = true
    this.flushPersist()
  },

  /**
   * Write if anything is pending. A failed write leaves the data marked
   * pending so the next flush retries it rather than dropping the edit.
   */
  flushPersist() {
    clearTimeout(persistTimer)
    persistTimer = undefined
    if (!dirty) return
    if (touchedSession) {
      touchedSession.updatedAt = Date.now()
      touchedSession = null
    }
    // Serialize the raw objects, not the reactive proxies (~60% cheaper).
    const ok =
      storage.saveSessions(Alpine.raw(this.sessions)) && storage.saveActiveSession(this.activeId)
    dirty = !ok
    this.storageError = ok ? '' : STORAGE_ERROR_MESSAGE
  },

  providerFor(col: PromptColumn): Provider | undefined {
    return this.providers.find((p) => p.id === col.settings.providerId)
  },

  modelsFor(col: PromptColumn) {
    return this.providerFor(col)?.models ?? []
  },

  canEnhance(col: PromptColumn): boolean {
    return !this.enhanceBlocker(col)
  },

  /**
   * Why this column can't be enhanced right now, or '' when it can. The button
   * is disabled for four different reasons and used to explain none of them —
   * its title offered a keyboard shortcut that would not have worked either.
   */
  enhanceBlocker(col: PromptColumn): string {
    if (this.enhancing) {
      return this.enhancing.sourceId === col.id ? 'Enhancing…' : 'Another enhancement is running.'
    }
    if (!this.providerFor(col)) {
      return this.providers.length === 0
        ? 'Add a provider in Settings first.'
        : 'Choose a provider in Advanced settings.'
    }
    if (!col.settings.modelId) return 'Choose a model in Advanced settings.'
    if (!col.text.trim()) return 'Write a prompt first.'
    return ''
  },

  /**
   * Mark a session as edited. The title updates at once (cheap); the recency
   * bump that re-sorts the sidebar is deferred to the next persist flush so
   * the list doesn't re-sort on every keystroke.
   */
  touch(target?: Session) {
    const session = target ?? this.session
    touchedSession = session
    const first = session.chain[0]?.text ?? ''
    if (first.trim() && !session.customTitle) {
      session.title = titleFromPrompt(first, session.title)
    }
    this.persist()
  },

  createSession() {
    const s = newSession(this.providers)
    this.sessions.push(s)
    this.openSession(s.id)
  },

  openSession(id: string) {
    this.activeId = id
    this.error = ''
    this.previewId = ''
    // The undo offer belongs to the view the user is leaving.
    this.undoReplace = null
    this.notice = ''
    // The session may have been saved at a different viewport width.
    const session = this.session
    session.viewIndex = clampView(session.viewIndex, session.chain.length, this.visibleColumns)
    this.persistNow()
  },

  startRename(s: Session) {
    this.renamingId = s.id
    this.renameDraft = s.title
  },

  /**
   * Apply the inline rename. A hand-set title stops following the prompt's
   * first line (`customTitle`). Clearing the field cancels; Escape too.
   */
  commitRename() {
    const s = this.sessions.find((x) => x.id === this.renamingId)
    this.renamingId = ''
    if (!s) return
    const title = this.renameDraft.trim()
    if (!title || title === s.title) return
    s.title = title
    s.customTitle = true
    this.persistNow()
  },

  cancelRename() {
    this.renamingId = ''
  },

  /** Download every session as JSON. Providers and API keys are never included. */
  exportSessions() {
    this.persistNow()
    const blob = new Blob([serializeSessions(Alpine.raw(this.sessions))], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName()
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },

  /**
   * Restore sessions from an export. Same ids replace the stored session
   * (so re-importing a backup restores it), new ids are added; the first
   * imported session is opened.
   */
  async importSessions(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const parsed = parseSessionsFile(await file.text())
      // Migrating can reject an individual record; skip those rather than
      // failing the whole import.
      const { sessions: imported, rejected } = migrateAll(parsed, this.providers)
      if (imported.length === 0) throw new Error('none of its sessions could be read')
      const { sessions, added, replaced } = mergeSessions(Alpine.raw(this.sessions), imported)
      if (this.enhancing && imported.some((s) => s.id === this.enhancing?.sessionId)) {
        this.cancelEnhance()
      }
      this.sessions = sessions
      this.error = ''
      this.openSession(imported[0].id)
      const parts = []
      if (added) parts.push(`${added} added`)
      if (replaced) parts.push(`${replaced} replaced`)
      if (rejected.length) parts.push(`${rejected.length} unreadable, skipped`)
      this.showNotice(`Imported ${imported.length} session${imported.length === 1 ? '' : 's'} (${parts.join(', ')}).`)
    } catch (err) {
      this.error = `Import failed: ${err instanceof Error ? err.message : String(err)}`
    }
  },

  /** Ctrl/⌘+Enter inside a column's editor: enhance from that column. */
  enhanceShortcut(i: number) {
    const col = this.session.chain[i]
    if (col && this.canEnhance(col)) void this.enhanceFrom(i)
  },

  toggleStar(id: string) {
    const s = this.sessions.find((x) => x.id === id)
    if (!s) return
    s.starred = !s.starred
    this.persistNow()
  },

  togglePin(id: string) {
    const s = this.sessions.find((x) => x.id === id)
    if (!s) return
    s.pinned = !s.pinned
    this.persistNow()
  },

  /**
   * Archive or restore a session. Archiving also unpins it (a hidden session
   * can't hold a top slot) and, if it was the active one, moves focus to the
   * first remaining visible session — creating a fresh one if none are left.
   */
  toggleArchive(id: string) {
    const s = this.sessions.find((x) => x.id === id)
    if (!s) return
    s.archived = !s.archived
    if (s.archived) {
      s.pinned = false
      if (this.activeId === id) {
        let next = this.visibleSessions[0]
        if (!next) {
          next = newSession(this.providers)
          this.sessions.push(next)
        }
        this.openSession(next.id)
        return
      }
    }
    this.persistNow()
  },

  deleteSession(id: string) {
    if (!confirm('Delete this session and its entire enhancement chain?')) return
    if (this.enhancing?.sessionId === id) this.cancelEnhance()
    this.sessions = this.sessions.filter((s) => s.id !== id)
    // Remember the deletion so another tab holding a stale copy of this
    // session cannot write it back the next time it saves.
    storage.addDeleted(id)
    if (this.sessions.length === 0) this.sessions.push(newSession(this.providers))
    if (this.activeId === id) this.openSession(this.sessions[0].id)
    this.persistNow()
  },

  /**
   * Open or close a column's advanced settings. The panel covers the editor, so
   * focus moves into it on open and back to the trigger on close — otherwise
   * keyboard users had to tab through the controls it is drawn on top of.
   */
  toggleAdvanced(col: PromptColumn, trigger?: HTMLElement) {
    if (this.advancedOpen(col)) return this.closeAdvanced(col)
    this.openAdvanced[col.id] = true
    if (trigger) advancedTriggers.set(col.id, trigger)
    this.$nextTick(() => {
      const panel = trigger?.closest('.chain-card')?.querySelector('.advanced-panel')
      if (panel instanceof HTMLElement) panel.focus()
    })
  },

  closeAdvanced(col: PromptColumn) {
    if (!this.advancedOpen(col)) return
    this.openAdvanced[col.id] = false
    const trigger = advancedTriggers.get(col.id)
    advancedTriggers.delete(col.id)
    if (trigger?.isConnected) trigger.focus()
  },

  /** Collapsed-state summary shown on the Advanced settings trigger. */
  advancedSummary(col: PromptColumn): string {
    const provider = this.providerFor(col)
    if (!provider) return 'no provider selected'
    const model = provider.models.find((m) => m.id === col.settings.modelId)
    return model ? `${provider.name} · ${model.label || model.modelId}` : provider.name
  },

  onProviderChange(col: PromptColumn) {
    col.settings.modelId = defaultModelFor(this.providerFor(col))?.id ?? ''
    this.persist()
  },

  isPracticeSelected(col: PromptColumn, collectionId: string): boolean {
    return col.settings.target.bestPracticeIds.includes(collectionId)
  },

  /** Selected collections that still exist — drives the "not applied" notice. */
  selectedPracticeCount(col: PromptColumn): number {
    return col.settings.target.bestPracticeIds.filter((id) =>
      this.bestPractices.some((c) => c.id === id),
    ).length
  },

  togglePractice(col: PromptColumn, collectionId: string) {
    const ids = col.settings.target.bestPracticeIds
    const at = ids.indexOf(collectionId)
    if (at === -1) ids.push(collectionId)
    else ids.splice(at, 1)
    this.persist()
  },

  /**
   * Resolve the column's selected collections (in selection order) into the
   * flat list of enabled rules injected into the enhancer's system prompt.
   * Ids of collections deleted in Settings are skipped silently.
   */
  collectBestPractices(col: PromptColumn): AppliedBestPractice[] {
    const rules: AppliedBestPractice[] = []
    for (const id of col.settings.target.bestPracticeIds) {
      const collection = this.bestPractices.find((c) => c.id === id)
      if (!collection) continue
      for (const item of collection.items) {
        if (!item.enabled || !item.content.trim()) continue
        rules.push({
          collection: collection.name,
          target: collection.target,
          kind: item.kind,
          content: item.content,
        })
      }
    }
    return rules
  },

  /**
   * Enhance the chain link at `index` using only that column's settings,
   * instruction, and text. The result becomes the next column, which starts
   * with an independent copy of the source column's configuration. Any links
   * after the source are replaced — they were derived from the old output —
   * but only once the request succeeds: on failure or cancel they come back.
   */
  async enhanceFrom(index: number) {
    // Capture the session up front: `this.session` is a getter, and the user
    // may switch sessions while the request is in flight.
    const session = this.session
    const source = session.chain[index]
    if (!source || this.enhancing) return
    const text = source.text.trim()
    const provider = this.providerFor(source)
    const model = provider?.models.find((m) => m.id === source.settings.modelId)
    if (!text || !provider || !model) return

    // Later links are derived from this column's old output. Confirm before
    // replacing them, and keep them so a failed request can put them back.
    const removed = session.chain.slice(index + 1)
    if (
      removed.length > 0 &&
      !confirm(
        `Enhancing v${index + 1} again replaces ${removed.length} later ${removed.length === 1 ? 'link' : 'links'} (v${index + 2}${removed.length > 1 ? `–v${index + 1 + removed.length}` : ''}). Continue?`,
      )
    )
      return
    const previousViewIndex = session.viewIndex
    const previousPreviewId = this.previewId

    this.error = ''
    // Any earlier undo is about links this run is superseding.
    this.undoReplace = null
    session.chain.splice(index + 1)
    // Create the next link up front and stream tokens into it so the
    // response appears in real time.
    // The new link starts fresh: its instruction is cleared and its advanced
    // settings are collapsed, so it doesn't inherit the source column's UI
    // state (newColumn defaults instruction to '' and showAdvanced to false).
    session.chain.push(
      newColumn(source.settings, {
        producedBy: `${provider.name} / ${model.label || model.modelId}`,
      }),
    )
    // Re-read through the session proxy so writes to `target.text` below are
    // reactive — mutating the raw pushed object would not update the UI.
    const target = session.chain[session.chain.length - 1]
    this.enhancing = { sessionId: session.id, sourceId: source.id, targetId: target.id }
    const controller = new AbortController()
    activeController = controller
    // Follow the newest link in the preview pane so the enhanced prompt's
    // Markdown renders live as it streams in.
    if (this.activeId === session.id) this.previewId = ''
    // Let the new column render, then slide the chain so the new link is the
    // last visible column: source + new on desktop, the new link alone on
    // narrow screens.
    if (this.activeId === session.id) {
      requestAnimationFrame(() => {
        session.viewIndex = viewIndexAfterEnhance(
          index + 1,
          session.chain.length,
          visibleColumnCount(),
        )
      })
    }
    // Reasoning models stream a chain-of-thought before the answer. The first
    // reasoning chunk starts the "thinking" phase (pulsing indicator + live
    // timer); the first content chunk — or the end of the request — ends it,
    // freezing the elapsed time onto the column for the collapsed summary. A
    // model may alternate between the two, so phases are summed, not replaced.
    let reasoningTotal = 0
    const startThinking = () => {
      if (this.thinkingId === target.id) return
      this.thinkingId = target.id
      this.thinkingSeconds = 0
      const startedAt = Date.now()
      this._thinkTimer = setInterval(() => {
        this.thinkingSeconds = Math.round((Date.now() - startedAt) / 1000)
      }, 1000)
    }
    const stopThinking = () => {
      if (this.thinkingId !== target.id) return
      clearInterval(this._thinkTimer)
      reasoningTotal += this.thinkingSeconds
      target.reasoningSeconds = reasoningTotal
      this.thinkingId = ''
    }
    // Stream chunks arrive one per task; writing each straight into reactive
    // state would re-render the textarea, preview and reasoning strip per
    // token. Buffer them and apply at most once per animation frame.
    let pendingReasoning = ''
    let pendingText: string | null = null
    let frame = 0
    const flushStream = () => {
      frame = 0
      if (pendingReasoning) {
        target.reasoning += pendingReasoning
        pendingReasoning = ''
      }
      if (pendingText !== null) {
        target.text = pendingText
        pendingText = null
      }
    }
    const scheduleFlush = () => {
      if (!frame) frame = requestAnimationFrame(flushStream)
    }
    try {
      const enhanced = await enhancePrompt(
        provider,
        model.modelId,
        text,
        {
          options: source.settings.options,
          outputLanguage: source.settings.outputLanguage,
          outputFormat: source.settings.outputFormat,
          instruction: source.instruction,
          target: source.settings.target,
          // The "Best practices" option is the master switch: selected
          // collections are only applied when it is enabled.
          bestPractices: source.settings.options.bestPractices
            ? this.collectBestPractices(source)
            : [],
        },
        (chunk, fullText, kind) => {
          if (kind === 'reasoning') {
            startThinking()
            pendingReasoning += chunk
          } else {
            stopThinking()
            pendingText = fullText
          }
          scheduleFlush()
        },
        controller.signal,
      )
      cancelAnimationFrame(frame)
      flushStream()
      target.text = enhanced
      target.reasoning = capReasoning(target.reasoning)
      this.touch(session)
      // Enhancing an earlier column destroyed the links after it. Keep them
      // reachable for a moment rather than leaving the confirm() as the only
      // thing standing between a mis-aimed click and a lost chain.
      if (removed.length > 0) {
        this.undoReplace = { sessionId: session.id, index, links: removed }
        const n = removed.length
        this.showNotice(`Replaced ${n} later ${n === 1 ? 'link' : 'links'}.`, 12000)
      }
    } catch (err) {
      // Drop the placeholder and put the previously removed links back, so
      // a failed or cancelled request leaves the chain exactly as it was.
      cancelAnimationFrame(frame)
      frame = 0
      const at = session.chain.indexOf(target)
      if (at !== -1) session.chain.splice(at, 1, ...removed)
      session.viewIndex = clampView(previousViewIndex, session.chain.length)
      // Restore the previewed column only if the user didn't pick another one
      // while the response was streaming.
      if (this.activeId === session.id && this.previewId === '') {
        this.previewId = previousPreviewId
      }
      if (!(err instanceof EnhanceCancelledError)) {
        this.error = err instanceof Error ? err.message : String(err)
      }
      this.persist()
    } finally {
      stopThinking()
      this.enhancing = null
      activeController = null
    }
  },

  /** Abort the in-flight enhancement; `enhanceFrom` restores the chain. */
  cancelEnhance() {
    activeController?.abort()
  },

  toggleReasoning(col: PromptColumn) {
    this.openReasoning[col.id] = !this.reasoningOpen(col)
  },

  prevView() {
    const session = this.session
    if (session.viewIndex > 0) {
      session.viewIndex--
      this.persist()
    }
  },

  nextView() {
    const session = this.session
    if (session.viewIndex < this.maxViewIndex) {
      session.viewIndex++
      this.persist()
    }
  },

  /**
   * Copy a single column's prompt text to the system clipboard. Prefers the
   * async Clipboard API and falls back to a hidden-textarea + execCommand copy
   * for insecure contexts (e.g. plain http://) and older browsers that lack it.
   * Feedback lives in `copiedId` — separate from the column so showing "Copied!"
   * never touches `col.text` and can't re-render the editor content.
   */
  async copyColumn(col: PromptColumn) {
    const text = col.text
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.top = '-9999px'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('copy command was rejected')
      }
      this.copiedId = col.id
      clearTimeout(this._copiedTimer)
      this._copiedTimer = setTimeout(() => {
        this.copiedId = ''
      }, 1500)
    } catch {
      this.error = 'Could not copy to the clipboard.'
    }
  },

  formatDate(ts: number): string {
    return dateFormatter.format(ts)
  },
}))

Alpine.start()
renderBuildInfo()
