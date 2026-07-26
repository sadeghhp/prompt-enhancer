import Alpine from 'alpinejs'
import { enhancePrompt } from './api'
import type { AppliedBestPractice } from './api'
import { storage } from './storage'
import { applyTheme, loadTheme, saveTheme } from './theme'
import { DEFAULT_OPTIONS, TARGET_PLATFORMS, TARGET_TYPES, defaultTarget, uid } from './types'
import type {
  BestPracticeCollection,
  ColumnSettings,
  PromptColumn,
  Provider,
  Session,
} from './types'

/** The provider's configured default model, falling back to its first model. */
function defaultModelFor(provider: Provider | undefined) {
  if (!provider) return undefined
  return provider.models.find((m) => m.id === provider.defaultModelId) ?? provider.models[0]
}

function defaultSettings(providers: Provider[]): ColumnSettings {
  const provider = providers[0]
  return {
    providerId: provider?.id ?? '',
    modelId: defaultModelFor(provider)?.id ?? '',
    outputLanguage: 'English',
    options: { ...DEFAULT_OPTIONS },
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
    showAdvanced: false,
    showReasoning: false,
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

/** Convert sessions saved with the old draft/versions shape into a chain. */
function migrateSession(s: Session, providers: Provider[]): void {
  if (Array.isArray(s.chain) && s.chain.length > 0) {
    // Fill fields added after the chain feature shipped
    for (const col of s.chain) {
      col.instruction ??= ''
      col.producedBy ??= ''
      col.reasoning ??= ''
      col.reasoningSeconds ??= 0
      col.showAdvanced ??= false
      col.showReasoning ??= false
      col.settings.target ??= defaultTarget()
      col.settings.target.bestPracticeIds ??= []
    }
    s.viewIndex = clampView(s.viewIndex ?? 0, s.chain.length)
    return
  }
  const settings = s.settings ?? defaultSettings(providers)
  settings.target ??= defaultTarget()
  const chain: PromptColumn[] = [
    newColumn(settings, {
      text: s.draft ?? '',
      instruction: s.instruction ?? '',
      createdAt: s.createdAt,
    }),
  ]
  for (const v of s.versions ?? []) {
    chain.push(
      newColumn(settings, {
        id: v.id,
        text: v.text,
        createdAt: v.createdAt,
        producedBy: v.model,
        showAdvanced: false,
      }),
    )
  }
  s.chain = chain
  s.viewIndex = clampView(chain.length - 1, chain.length)
  delete s.draft
  delete s.instruction
  delete s.versions
  delete s.settings
}

function clampView(index: number, chainLength: number): number {
  return Math.min(Math.max(0, index), Math.max(0, chainLength - 2))
}

Alpine.data('mainApp', () => ({
  providers: [] as Provider[],
  sessions: [] as Session[],
  bestPractices: [] as BestPracticeCollection[],
  targetPlatforms: TARGET_PLATFORMS,
  targetTypes: TARGET_TYPES,
  activeId: '' as string,
  enhancing: false,
  /** Column id currently in the reasoning phase; empty when none */
  thinkingId: '' as string,
  /** Live elapsed seconds while `thinkingId` is set */
  thinkingSeconds: 0,
  _thinkTimer: 0 as ReturnType<typeof setInterval> | 0,
  error: '',
  copiedId: '' as string,
  _copiedTimer: 0 as ReturnType<typeof setTimeout> | 0,
  theme: loadTheme(),

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark'
    applyTheme(this.theme)
    saveTheme(this.theme)
  },

  init() {
    this.providers = storage.loadProviders()
    this.bestPractices = storage.loadBestPractices()
    this.sessions = storage.loadSessions()
    for (const s of this.sessions) migrateSession(s, this.providers)
    if (this.sessions.length === 0) {
      this.sessions.push(newSession(this.providers))
    }
    const savedActive = storage.loadActiveSession()
    this.activeId =
      savedActive && this.sessions.some((s) => s.id === savedActive)
        ? savedActive
        : this.sessions[0].id
    this.persist()
    // ← / → slide the chain viewport — unless the user is typing in a field
    // or using a browser shortcut (Alt+← = back).
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return
      e.preventDefault()
      if (e.key === 'ArrowLeft') this.prevView()
      else this.nextView()
    })
  },

  get session(): Session {
    return this.sessions.find((s) => s.id === this.activeId) ?? this.sessions[0]
  },

  get sortedSessions(): Session[] {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  },

  /** Highest allowed viewIndex: the last two columns fill the viewport. */
  get maxViewIndex(): number {
    return Math.max(0, this.session.chain.length - 2)
  },

  persist() {
    storage.saveSessions(this.sessions)
    storage.saveActiveSession(this.activeId)
  },

  providerFor(col: PromptColumn): Provider | undefined {
    return this.providers.find((p) => p.id === col.settings.providerId)
  },

  modelsFor(col: PromptColumn) {
    return this.providerFor(col)?.models ?? []
  },

  canEnhance(col: PromptColumn): boolean {
    return Boolean(
      !this.enhancing && this.providerFor(col) && col.settings.modelId && col.text.trim(),
    )
  },

  touch(target?: Session) {
    const session = target ?? this.session
    session.updatedAt = Date.now()
    const first = session.chain[0]?.text.trim()
    if (first) {
      const firstLine = first.split('\n')[0]
      session.title = firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine
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
    this.persist()
  },

  deleteSession(id: string) {
    if (!confirm('Delete this session and its entire enhancement chain?')) return
    this.sessions = this.sessions.filter((s) => s.id !== id)
    if (this.sessions.length === 0) this.sessions.push(newSession(this.providers))
    if (this.activeId === id) this.openSession(this.sessions[0].id)
    this.persist()
  },

  onProviderChange(col: PromptColumn) {
    col.settings.modelId = defaultModelFor(this.providerFor(col))?.id ?? ''
    this.persist()
  },

  isPracticeSelected(col: PromptColumn, collectionId: string): boolean {
    return col.settings.target.bestPracticeIds.includes(collectionId)
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
   * after the source are replaced — they were derived from the old output.
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

    this.enhancing = true
    this.error = ''
    session.chain.splice(index + 1)
    // Create the next link up front and stream tokens into it so the
    // response appears in real time.
    session.chain.push(
      newColumn(source.settings, {
        instruction: source.instruction,
        producedBy: `${provider.name} / ${model.label || model.modelId}`,
        showAdvanced: source.showAdvanced,
      }),
    )
    // Re-read through the session proxy so writes to `target.text` below are
    // reactive — mutating the raw pushed object would not update the UI.
    const target = session.chain[session.chain.length - 1]
    // Let the new column render, then slide the chain one position left so
    // the source and the new link fill the viewport.
    if (this.activeId === session.id) {
      requestAnimationFrame(() => {
        session.viewIndex = clampView(index, session.chain.length)
      })
    }
    // Reasoning models stream a chain-of-thought before the answer. The first
    // reasoning chunk starts the "thinking" phase (pulsing indicator + live
    // timer); the first content chunk — or the end of the request — ends it,
    // freezing the elapsed time onto the column for the collapsed summary.
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
      target.reasoningSeconds = this.thinkingSeconds
      this.thinkingId = ''
    }
    try {
      const enhanced = await enhancePrompt(
        provider,
        model.modelId,
        text,
        {
          options: source.settings.options,
          outputLanguage: source.settings.outputLanguage,
          instruction: source.instruction,
          target: source.settings.target,
          bestPractices: this.collectBestPractices(source),
        },
        (chunk, fullText, kind) => {
          if (kind === 'reasoning') {
            startThinking()
            target.reasoning += chunk
          } else {
            stopThinking()
            target.text = fullText
          }
        },
      )
      target.text = enhanced
      this.touch(session)
    } catch (err) {
      // Drop the placeholder so a failed request leaves no empty link.
      session.chain = session.chain.filter((c) => c.id !== target.id)
      session.viewIndex = clampView(session.viewIndex, session.chain.length)
      this.error = err instanceof Error ? err.message : String(err)
      this.persist()
    } finally {
      stopThinking()
      this.enhancing = false
    }
  },

  toggleReasoning(col: PromptColumn) {
    col.showReasoning = !col.showReasoning
    this.persist()
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
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  },
}))

Alpine.start()
