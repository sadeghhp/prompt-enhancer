import Alpine from 'alpinejs'
import { fetchProviderModels, testModel, testProvider } from './api'
import { renderBuildInfo } from './build-info'
import { STORAGE_ERROR_MESSAGE, storage } from './storage'
import { applyTheme, loadTheme, saveTheme } from './theme'
import { BEST_PRACTICE_KINDS, OUTPUT_FORMATS, TARGET_PLATFORMS, factoryDefaults, uid } from './types'
import type { BestPracticeCollection, DefaultSettings, Provider } from './types'

interface TestState {
  status: 'idle' | 'running' | 'ok' | 'error'
  message: string
}

/**
 * Transient state of the "fetch & pick models" panel for one provider.
 * Kept out of localStorage on purpose: only the applied selection is
 * persisted, so a provider with thousands of models doesn't bloat storage.
 */
interface ModelPicker {
  status: 'loading' | 'error' | 'ready'
  message: string
  /** Fetched model IDs plus any modelIds already configured on the provider */
  available: string[]
  selected: Record<string, boolean>
  filter: string
  /** How many filtered rows are rendered; grown via "Show more" */
  limit: number
}

/** Rows rendered per page in the picker, so huge lists stay responsive */
const PICKER_PAGE = 200

/**
 * Newest fetch per provider. A second "Fetch models" (or Retry) while one is
 * in flight must win, and the older response must not overwrite its panel.
 */
const pickerRequests = new Map<string, number>()
let pickerRequestSeq = 0

/**
 * Memo for the picker's filtered list, keyed by provider. The template reads
 * the filtered list several times per render (count, rows, "show more"), and
 * a provider can expose several thousand model ids, so recomputing per read
 * made typing in the filter box stutter. Kept outside the reactive data so
 * reading it never writes reactive state during a render.
 */
const filterCache = new Map<string, { key: string; ids: string[] }>()

function filterModels(available: string[], filter: string): string[] {
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return available
  return available.filter((id) => {
    const lower = id.toLowerCase()
    return terms.every((t) => lower.includes(t))
  })
}

Alpine.data('settingsApp', () => ({
  providers: [] as Provider[],
  bestPractices: [] as BestPracticeCollection[],
  defaults: factoryDefaults() as DefaultSettings,
  practiceKinds: BEST_PRACTICE_KINDS,
  outputFormats: OUTPUT_FORMATS,
  targetPlatforms: TARGET_PLATFORMS,
  /** Test state keyed by provider id or `${providerId}:${modelId}` */
  tests: {} as Record<string, TestState>,
  revealedKeys: {} as Record<string, boolean>,
  /** Model picker state keyed by provider id */
  pickers: {} as Record<string, ModelPicker>,
  theme: loadTheme(),
  /** Set when a write to localStorage fails; shown as a persistent banner */
  storageError: '',
  /** Brief "Saved" acknowledgement — the page has no Save button to press */
  saved: false,
  _savedTimer: 0 as ReturnType<typeof setTimeout> | 0,

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark'
    applyTheme(this.theme)
    saveTheme(this.theme)
  },

  init() {
    this.providers = storage.loadProviders()
    this.bestPractices = storage.loadBestPractices()
    this.defaults = storage.loadDefaults()
  },

  /** Record the outcome of a write so a full/blocked storage is never silent. */
  noteSave(ok: boolean) {
    this.storageError = ok ? '' : STORAGE_ERROR_MESSAGE
    if (!ok) return
    this.saved = true
    clearTimeout(this._savedTimer)
    this._savedTimer = setTimeout(() => {
      this.saved = false
    }, 1800)
  },

  persist() {
    this.noteSave(storage.saveProviders(Alpine.raw(this.providers)))
  },

  persistDefaults() {
    this.noteSave(storage.saveDefaults(Alpine.raw(this.defaults)))
  },

  /** Reset the enhancement defaults back to the out-of-the-box values. */
  resetDefaults() {
    this.defaults = factoryDefaults()
    this.persistDefaults()
  },

  persistPractices() {
    this.noteSave(storage.saveBestPractices(Alpine.raw(this.bestPractices)))
  },

  addCollection() {
    this.bestPractices.push({ id: uid(), name: 'New collection', target: '', items: [] })
    this.persistPractices()
  },

  removeCollection(id: string) {
    const collection = this.bestPractices.find((c) => c.id === id)
    if (collection?.items.length && !confirm(`Delete "${collection.name}" and its ${collection.items.length} rules?`)) return
    this.bestPractices = this.bestPractices.filter((c) => c.id !== id)
    this.persistPractices()
  },

  addPracticeItem(collection: BestPracticeCollection) {
    collection.items.push({ id: uid(), kind: 'rule', content: '', enabled: true })
    this.persistPractices()
  },

  removePracticeItem(collection: BestPracticeCollection, itemId: string) {
    collection.items = collection.items.filter((i) => i.id !== itemId)
    this.persistPractices()
  },

  /** Move an item up (-1) or down (+1) within its collection. */
  movePracticeItem(collection: BestPracticeCollection, index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= collection.items.length) return
    const [item] = collection.items.splice(index, 1)
    collection.items.splice(to, 0, item)
    this.persistPractices()
  },

  addProvider() {
    this.providers.push({
      id: uid(),
      name: 'New provider',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      models: [],
    })
    this.persist()
  },

  /**
   * Removing a provider also discards its API key and model list, and there
   * is no undo, so it asks first — the button sits one row from "Test".
   */
  removeProvider(id: string) {
    const provider = this.providers.find((p) => p.id === id)
    if (!provider) return
    const models = provider.models.length
    const detail = models > 0 ? ` and its ${models} model${models === 1 ? '' : 's'}` : ''
    if (
      !confirm(
        `Remove “${provider.name || 'this provider'}”${detail}? Its API key will be deleted from this browser. This cannot be undone.`,
      )
    )
      return
    this.providers = this.providers.filter((p) => p.id !== id)
    filterCache.delete(id)
    pickerRequests.delete(id)
    this.persist()
  },

  addModel(provider: Provider) {
    provider.models.push({ id: uid(), modelId: '', label: '' })
    this.persist()
  },

  removeModel(provider: Provider, modelId: string) {
    provider.models = provider.models.filter((m) => m.id !== modelId)
    if (provider.defaultModelId === modelId) delete provider.defaultModelId
    this.persist()
  },

  setDefaultModel(provider: Provider, modelId: string) {
    provider.defaultModelId = provider.defaultModelId === modelId ? undefined : modelId
    this.persist()
  },

  async openModelPicker(provider: Provider) {
    const token = ++pickerRequestSeq
    pickerRequests.set(provider.id, token)
    filterCache.delete(provider.id)
    this.pickers[provider.id] = {
      status: 'loading',
      message: 'Fetching models…',
      available: [],
      selected: {},
      filter: '',
      limit: PICKER_PAGE,
    }
    const result = await fetchProviderModels(provider)
    // A newer fetch for this provider started while this one was in flight.
    if (pickerRequests.get(provider.id) !== token) return
    const picker = this.pickers[provider.id]
    if (!picker) return // panel was closed while the request was in flight
    if (!result.ok) {
      picker.status = 'error'
      picker.message = result.message
      return
    }
    // Include already-configured models (e.g. manually added ones the
    // provider doesn't list) so applying the selection never loses them.
    const configured = provider.models.map((m) => m.modelId).filter(Boolean)
    picker.available = [...new Set([...result.models, ...configured])].sort((a, b) =>
      a.localeCompare(b),
    )
    for (const id of configured) picker.selected[id] = true
    picker.status = 'ready'
    picker.message = result.message
  },

  closeModelPicker(providerId: string) {
    pickerRequests.delete(providerId)
    filterCache.delete(providerId)
    delete this.pickers[providerId]
  },

  /**
   * Model ids matching the picker's filter. Reading `filter` and `available`
   * keeps this reactive; the result itself is memoized per provider so the
   * several reads each render cost one pass, not several.
   */
  filteredPickerModels(providerId: string): string[] {
    const picker = this.pickers[providerId]
    if (!picker) return []
    const key = `${picker.available.length} ${picker.filter}`
    const cached = filterCache.get(providerId)
    if (cached && cached.key === key) return cached.ids
    const ids = filterModels(picker.available, picker.filter)
    filterCache.set(providerId, { key, ids })
    return ids
  },

  visiblePickerModels(providerId: string): string[] {
    const picker = this.pickers[providerId]
    if (!picker) return []
    return this.filteredPickerModels(providerId).slice(0, picker.limit)
  },

  pickerSelectedCount(picker: ModelPicker): number {
    return Object.values(picker.selected).filter(Boolean).length
  },

  /** Select every model matching the current filter (not just visible rows). */
  selectAllFiltered(providerId: string) {
    const picker = this.pickers[providerId]
    if (!picker) return
    for (const id of this.filteredPickerModels(providerId)) picker.selected[id] = true
  },

  clearPickerSelection(picker: ModelPicker) {
    picker.selected = {}
  },

  /**
   * Replace the provider's model list with the picker selection, reusing
   * existing entries (and their labels/default flag) for models that stay.
   */
  applyModelSelection(provider: Provider) {
    const picker = this.pickers[provider.id]
    if (!picker) return
    const existing = new Map(provider.models.map((m) => [m.modelId, m]))
    provider.models = picker.available
      .filter((id) => picker.selected[id])
      .map((modelId) => existing.get(modelId) ?? { id: uid(), modelId, label: '' })
    if (!provider.models.some((m) => m.id === provider.defaultModelId)) {
      delete provider.defaultModelId
    }
    this.closeModelPicker(provider.id)
    this.persist()
  },

  testState(key: string): TestState {
    return this.tests[key] ?? { status: 'idle', message: '' }
  },

  async runProviderTest(provider: Provider) {
    this.tests[provider.id] = { status: 'running', message: 'Testing…' }
    const result = await testProvider(provider)
    this.tests[provider.id] = {
      status: result.ok ? 'ok' : 'error',
      message: result.message,
    }
  },

  async runModelTest(provider: Provider, modelDbId: string) {
    const model = provider.models.find((m) => m.id === modelDbId)
    if (!model?.modelId) return
    const key = `${provider.id}:${modelDbId}`
    this.tests[key] = { status: 'running', message: 'Testing…' }
    const result = await testModel(provider, model.modelId)
    this.tests[key] = { status: result.ok ? 'ok' : 'error', message: result.message }
  },
}))

Alpine.start()
renderBuildInfo()
