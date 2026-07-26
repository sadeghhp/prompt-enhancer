import Alpine from 'alpinejs'
import { testModel, testProvider } from './api'
import { storage } from './storage'
import { uid } from './types'
import type { Provider } from './types'

interface TestState {
  status: 'idle' | 'running' | 'ok' | 'error'
  message: string
}

Alpine.data('settingsApp', () => ({
  providers: [] as Provider[],
  /** Test state keyed by provider id or `${providerId}:${modelId}` */
  tests: {} as Record<string, TestState>,
  revealedKeys: {} as Record<string, boolean>,

  init() {
    this.providers = storage.loadProviders()
  },

  persist() {
    storage.saveProviders(this.providers)
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

  removeProvider(id: string) {
    this.providers = this.providers.filter((p) => p.id !== id)
    this.persist()
  },

  addModel(provider: Provider) {
    provider.models.push({ id: uid(), modelId: '', label: '' })
    this.persist()
  },

  removeModel(provider: Provider, modelId: string) {
    provider.models = provider.models.filter((m) => m.id !== modelId)
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
