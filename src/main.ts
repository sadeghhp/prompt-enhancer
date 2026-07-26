import Alpine from 'alpinejs'
import { enhancePrompt } from './api'
import { storage } from './storage'
import { applyTheme, loadTheme, saveTheme } from './theme'
import { DEFAULT_OPTIONS, uid } from './types'
import type { ColumnSettings, PromptColumn, Provider, Session } from './types'

function defaultSettings(providers: Provider[]): ColumnSettings {
  const provider = providers[0]
  return {
    providerId: provider?.id ?? '',
    modelId: provider?.models[0]?.id ?? '',
    outputLanguage: 'English',
    options: { ...DEFAULT_OPTIONS },
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
    showAdvanced: true,
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
      col.showAdvanced ??= false
    }
    s.viewIndex = clampView(s.viewIndex ?? 0, s.chain.length)
    return
  }
  const settings = s.settings ?? defaultSettings(providers)
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
  activeId: '' as string,
  enhancing: false,
  error: '',
  theme: loadTheme(),

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark'
    applyTheme(this.theme)
    saveTheme(this.theme)
  },

  init() {
    this.providers = storage.loadProviders()
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
    col.settings.modelId = this.modelsFor(col)[0]?.id ?? ''
    this.persist()
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
    try {
      const enhanced = await enhancePrompt(
        provider,
        model.modelId,
        text,
        source.settings.options,
        source.settings.outputLanguage,
        source.instruction,
        (_chunk, fullText) => {
          target.text = fullText
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
      this.enhancing = false
    }
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

  copyColumn(col: PromptColumn) {
    void navigator.clipboard.writeText(col.text)
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
