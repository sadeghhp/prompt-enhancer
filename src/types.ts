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
  /** LlmModel.id of the model preselected for new columns of this provider */
  defaultModelId?: string
}

export interface EnhanceOptions {
  clarity: boolean
  structure: boolean
  bestPractices: boolean
  tokenEfficiency: boolean
  preserveIntent: boolean
}

export interface ColumnSettings {
  providerId: string
  modelId: string
  outputLanguage: string
  options: EnhanceOptions
}

/**
 * One link in the enhancement chain. Every column has the same shape:
 * its own settings, its own instruction, and its own editable prompt text.
 * Enhancing a column produces the next column in the chain.
 */
export interface PromptColumn {
  id: string
  /** Editable prompt text of this link */
  text: string
  /** Instruction guiding the enhancement that this column will produce */
  instruction: string
  settings: ColumnSettings
  createdAt: number
  /** Provider/model that generated this column's text; empty for the first link */
  producedBy: string
  /** UI state: whether this column's advanced settings panel is expanded */
  showAdvanced: boolean
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** The enhancement chain, oldest link first. Always has at least one column. */
  chain: PromptColumn[]
  /** Index of the leftmost column in the two-column viewport */
  viewIndex: number
  /* Legacy fields from the pre-chain data model; migrated on load */
  draft?: string
  instruction?: string
  versions?: { id: string; text: string; createdAt: number; model: string }[]
  settings?: ColumnSettings
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
