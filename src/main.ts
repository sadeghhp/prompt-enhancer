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

  touch() {
    this.session.updatedAt = Date.now()
    if (this.session.draft.trim()) {
      const firstLine = this.session.draft.trim().split('\n')[0]
      this.session.title = firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine
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
    this.versionIndex = Math.max(0, this.session.versions.length - 1)
    this.persist()
  },

  deleteSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id)
    if (this.sessions.length === 0) this.sessions.push(newSession(this.providers))
    if (this.activeId === id) this.openSession(this.sessions[0].id)
    this.persist()
  },

  onProviderChange() {
    this.session.settings.modelId = this.activeModels[0]?.id ?? ''
    this.persist()
  },

  modelLabel(): string {
    const m = this.activeModels.find((m) => m.id === this.session.settings.modelId)
    return m ? `${this.activeProvider?.name} / ${m.label}` : ''
  },

  /** Enhance the middle-column draft, or re-enhance an edited version. */
  async enhance(sourceText?: string) {
    const text = (sourceText ?? this.session.draft).trim()
    const provider = this.activeProvider
    const model = this.activeModels.find((m) => m.id === this.session.settings.modelId)
    if (!text || !provider || !model || this.enhancing) return

    this.enhancing = true
    this.error = ''
    try {
      const enhanced = await enhancePrompt(
        provider,
        model.modelId,
        text,
        this.session.settings.options,
        this.session.settings.outputLanguage,
      )
      this.session.versions.push({
        id: uid(),
        text: enhanced,
        createdAt: Date.now(),
        model: `${provider.name} / ${model.label}`,
      })
      this.touch()
      // Let the new card render, then slide to it.
      requestAnimationFrame(() => {
        this.versionIndex = this.session.versions.length - 1
      })
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
