export interface LlmModel {
  id: string
  /** Model identifier sent to the API, e.g. "gpt-4o-mini" */
  modelId: string
  label: string
}

export interface Provider {
  id: string
  name: string
  /** OpenAI-compatible base URL, e.g. "https://api.openai.com/v1" */
  baseUrl: string
  apiKey: string
  models: LlmModel[]
}

export interface EnhanceOptions {
  clarity: boolean
  structure: boolean
  bestPractices: boolean
  tokenEfficiency: boolean
  preserveIntent: boolean
}

export interface SessionSettings {
  providerId: string
  modelId: string
  outputLanguage: string
  options: EnhanceOptions
}

export interface PromptVersion {
  id: string
  text: string
  createdAt: number
  /** Model used to produce this version; empty for the original draft */
  model: string
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** The prompt being edited in the middle column */
  draft: string
  /** Enhanced versions, oldest first */
  versions: PromptVersion[]
  settings: SessionSettings
}

export const DEFAULT_OPTIONS: EnhanceOptions = {
  clarity: true,
  structure: true,
  bestPractices: true,
  tokenEfficiency: true,
  preserveIntent: true,
}

export function uid(): string {
  return crypto.randomUUID()
}
