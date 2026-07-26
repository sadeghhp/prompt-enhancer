import Alpine from 'alpinejs'
import { enhancePrompt } from './api'
import { storage } from './storage'
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

  init() {
    this.providers = storage.loadProviders()
    this.sessions = storage.loadSessions()
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
    try {
      const enhanced = await enhancePrompt(
        provider,
        model.modelId,
        text,
        session.settings.options,
        session.settings.outputLanguage,
      )
      session.versions.push({
        id: uid(),
        text: enhanced,
        createdAt: Date.now(),
        model: `${provider.name} / ${model.label || model.modelId}`,
      })
      this.touch(session)
      // Let the new card render, then slide to it — unless the user has
      // navigated to a different session in the meantime.
      if (this.activeId === session.id) {
        requestAnimationFrame(() => {
          this.versionIndex = session.versions.length - 1
        })
      }
    } catch (err) {
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
