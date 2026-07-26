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

export type BestPracticeKind = 'text' | 'rule' | 'block' | 'cursor' | 'convention'

export const BEST_PRACTICE_KINDS: { value: BestPracticeKind; label: string }[] = [
  { value: 'text', label: 'Plain-text guidance' },
  { value: 'rule', label: 'Individual rule' },
  { value: 'block', label: 'Structured instruction block' },
  { value: 'cursor', label: 'Cursor-style rule' },
  { value: 'convention', label: 'Platform prompting convention' },
]

export interface BestPracticeItem {
  id: string
  kind: BestPracticeKind
  content: string
  enabled: boolean
}

/**
 * A named, ordered set of prompting best practices for one target platform,
 * model, agent, or agent type. Columns opt into collections by id; only
 * enabled items are injected into the enhancer's system prompt.
 */
export interface BestPracticeCollection {
  id: string
  name: string
  /** What this collection targets (free text), e.g. "Claude Code" */
  target: string
  items: BestPracticeItem[]
}

/**
 * What the enhanced prompt should be optimized FOR. Independent of the
 * enhancer provider/model that performs the rewrite. All fields optional.
 */
export interface TargetSettings {
  /** Destination platform, e.g. "Claude Code", "ChatGPT", "Cursor" */
  platform: string
  /** Destination model, e.g. "claude-sonnet-5", "gpt-4o" */
  model: string
  /** Kind of destination, e.g. "Coding agent"; free text allows custom types */
  type: string
  /** BestPracticeCollection ids applied to enhancements from this column */
  bestPracticeIds: string[]
}

export const TARGET_PLATFORMS = [
  'ChatGPT',
  'Claude',
  'DeepSeek',
  'Gemini',
  'Claude Code',
  'Cursor',
  'GitHub Copilot',
  'Windsurf',
]

export const TARGET_TYPES = [
  'General-purpose LLM',
  'Coding agent',
  'Research agent',
  'Reasoning model',
  'Tool-using agent',
]

export function defaultTarget(): TargetSettings {
  return { platform: '', model: '', type: '', bestPracticeIds: [] }
}

export interface EnhanceOptions {
  clarity: boolean
  structure: boolean
  bestPractices: boolean
  tokenEfficiency: boolean
  preserveIntent: boolean
  /** Force a tight rewrite: brevity, efficiency, and clarity, without weakening the prompt */
  brevity: boolean
}

export interface ColumnSettings {
  /** Provider whose model performs the enhancement (the enhancer) */
  providerId: string
  /** Enhancer model — generates the next prompt version */
  modelId: string
  outputLanguage: string
  options: EnhanceOptions
  /** Optional: what the enhanced prompt should be optimized for */
  target: TargetSettings
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
  /** Chain-of-thought a reasoning model streamed while producing this text */
  reasoning: string
  /** Seconds the model spent reasoning; 0 when it exposed no reasoning */
  reasoningSeconds: number
  /** UI state: whether this column's advanced settings panel is expanded */
  showAdvanced: boolean
  /** UI state: whether this column's reasoning section is expanded */
  showReasoning: boolean
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
  /** Marked as a favorite; shown with an accent star, does not affect order */
  starred?: boolean
  /** Kept at the top of the session list regardless of recency */
  pinned?: boolean
  /** Hidden from the main list, tucked into the collapsible Archived section */
  archived?: boolean
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
  brevity: false,
}

export function uid(): string {
  return crypto.randomUUID()
}
