import Alpine from 'alpinejs'
import { enhancePrompt } from './api'
import { storage } from './storage'
import { applyTheme, loadTheme, saveTheme } from './theme'
import { DEFAULT_OPTIONS, uid } from './types'
import type { Provider, Session, SessionSettings } from './types'

function defaultSettings(providers: Provider[]): SessionSettings {
  const provider = providers[0]
  return {
    providerId: provider?.id ?? '',
    modelId: provider?.models[0]?.id ?? '',
    outputLanguage: 'English',
    options: { ...DEFAULT_OPTIONS },
  }
}

function newSession(providers: Provider[]): Session {
  const now = Date.now()
  return {
    id: uid(),
    title: 'New session',
    createdAt: now,
    updatedAt: now,
    draft: '',
    instruction: '',
    versions: [],
    settings: defaultSettings(providers),
  }
}

Alpine.data('mainApp', () => ({
  providers: [] as Provider[],
  sessions: [] as Session[],
  activeId: '' as string,
  versionIndex: 0,
  enhancing: false,
  error: '',
  showAdvanced: true,
  theme: loadTheme(),

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark'
    applyTheme(this.theme)
    saveTheme(this.theme)
  },

  init() {
    this.providers = storage.loadProviders()
    this.sessions = storage.loadSessions()
    // Sessions saved before the instruction feature existed lack the field
    for (const s of this.sessions) s.instruction ??= ''
    if (this.sessions.length === 0) {
      this.sessions.push(newSession(this.providers))
    }
    const savedActive = storage.loadActiveSession()
    this.activeId =
      savedActive && this.sessions.some((s) => s.id === savedActive)
        ? savedActive
        : this.sessions[0].id
    this.versionIndex = Math.max(0, this.session.versions.length - 1)
    this.persist()
  },

  get session(): Session {
    return this.sessions.find((s) => s.id === this.activeId) ?? this.sessions[0]
  },

  get sortedSessions(): Session[] {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  },

  get activeProvider(): Provider | undefined {
    return this.providers.find((p) => p.id === this.session.settings.providerId)
  },

  get activeModels() {
    return this.activeProvider?.models ?? []
  },

  get canEnhance(): boolean {
    return Boolean(
      !this.enhancing &&
        this.activeProvider &&
        this.session.settings.modelId &&
        this.session.draft.trim(),
    )
  },

  persist() {
    storage.saveSessions(this.sessions)
    storage.saveActiveSession(this.activeId)
  },

  touch(target?: Session) {
    const session = target ?? this.session
    session.updatedAt = Date.now()
    if (session.draft.trim()) {
      const firstLine = session.draft.trim().split('\n')[0]
      session.title = firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine
    }
    this.persist()
  },

  /** Persist edits made to an enhanced version's text. */
  touchVersion() {
    this.session.updatedAt = Date.now()
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
    this.versionIndex = Math.max(0, this.session.versions.length - 1)
    this.persist()
  },

  deleteSession(id: string) {
    if (!confirm('Delete this session and all its prompt versions?')) return
    this.sessions = this.sessions.filter((s) => s.id !== id)
    if (this.sessions.length === 0) this.sessions.push(newSession(this.providers))
    if (this.activeId === id) this.openSession(this.sessions[0].id)
    this.persist()
  },

  onProviderChange() {
    this.session.settings.modelId = this.activeModels[0]?.id ?? ''
    this.persist()
  },

  /** Enhance the middle-column draft, or re-enhance an edited version. */
  async enhance(sourceText?: string) {
    // Capture the session up front: `this.session` is a getter, and the user
    // may switch sessions while the request is in flight.
    const session = this.session
    const text = (sourceText ?? session.draft).trim()
    const provider = this.activeProvider
    const model = provider?.models.find((m) => m.id === session.settings.modelId)
    if (!text || !provider || !model || this.enhancing) return

    this.enhancing = true
    this.error = ''
    // Create the version card up front and stream tokens into it so the
    // response appears in real time.
    session.versions.push({
      id: uid(),
      text: '',
      createdAt: Date.now(),
      model: `${provider.name} / ${model.label || model.modelId}`,
    })
    // Re-read through the session proxy so writes to `version.text` below are
    // reactive — mutating the raw pushed object would not update the UI.
    const version = session.versions[session.versions.length - 1]
    // Let the new card render, then slide to it — unless the user has
    // navigated to a different session in the meantime.
    if (this.activeId === session.id) {
      requestAnimationFrame(() => {
        this.versionIndex = session.versions.length - 1
      })
    }
    try {
      const enhanced = await enhancePrompt(
        provider,
        model.modelId,
        text,
        session.settings.options,
        session.settings.outputLanguage,
        session.instruction,
        (_chunk, fullText) => {
          version.text = fullText
        },
      )
      version.text = enhanced
      this.touch(session)
    } catch (err) {
      // Drop the placeholder card so a failed request leaves no empty version.
      session.versions = session.versions.filter((v) => v.id !== version.id)
      if (this.activeId === session.id) {
        this.versionIndex = Math.min(this.versionIndex, Math.max(0, session.versions.length - 1))
      }
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.enhancing = false
    }
  },

  enhanceCurrentVersion() {
    const current = this.session.versions[this.versionIndex]
    if (current) void this.enhance(current.text)
  },

  prevVersion() {
    if (this.versionIndex > 0) this.versionIndex--
  },

  nextVersion() {
    if (this.versionIndex < this.session.versions.length - 1) this.versionIndex++
  },

  useVersionAsDraft() {
    const current = this.session.versions[this.versionIndex]
    if (current) {
      this.session.draft = current.text
      this.touch()
    }
  },

  copyVersion() {
    const current = this.session.versions[this.versionIndex]
    if (current) void navigator.clipboard.writeText(current.text)
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
