import type { EnhanceOptions, Provider } from './types'

export interface TestResult {
  ok: boolean
  message: string
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function authHeaders(provider: Provider): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`
  return headers
}

/** Verify the provider endpoint and key by listing its models. */
export async function testProvider(provider: Provider): Promise<TestResult> {
  try {
    const res = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/models`, {
      headers: authHeaders(provider),
    })
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}: ${await safeError(res)}` }
    }
    const data = await res.json()
    const count = Array.isArray(data?.data) ? data.data.length : 0
    return { ok: true, message: `Connected — ${count} models available` }
  } catch (err) {
    return { ok: false, message: describeNetworkError(err) }
  }
}

export interface FetchModelsResult {
  ok: boolean
  message: string
  /** Model ID strings as reported by the provider, deduplicated and sorted */
  models: string[]
}

/** List the model IDs the provider exposes via its /models endpoint. */
export async function fetchProviderModels(provider: Provider): Promise<FetchModelsResult> {
  try {
    const res = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/models`, {
      headers: authHeaders(provider),
    })
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}: ${await safeError(res)}`, models: [] }
    }
    const data = await res.json()
    const raw: unknown[] = Array.isArray(data?.data) ? data.data : []
    const ids = [
      ...new Set(
        raw
          .map((m) => (m as { id?: unknown })?.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ].sort((a, b) => a.localeCompare(b))
    if (ids.length === 0) {
      return { ok: false, message: 'The provider returned no models.', models: [] }
    }
    return { ok: true, message: `${ids.length} models available`, models: ids }
  } catch (err) {
    return { ok: false, message: describeNetworkError(err), models: [] }
  }
}

/** Verify a specific model responds by requesting a minimal completion. */
export async function testModel(provider: Provider, modelId: string): Promise<TestResult> {
  try {
    const res = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(provider),
      body: JSON.stringify({
        model: modelId,
        // No max_tokens / temperature: newer OpenAI models reject max_tokens
        // (they require max_completion_tokens) and o-series reject custom
        // temperature — omitting both keeps the test provider-agnostic.
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      }),
    })
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}: ${await safeError(res)}` }
    }
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    return text
      ? { ok: true, message: 'Model responded successfully' }
      : { ok: false, message: 'Unexpected response shape from provider' }
  } catch (err) {
    return { ok: false, message: describeNetworkError(err) }
  }
}

function buildSystemPrompt(options: EnhanceOptions, outputLanguage: string, instruction?: string): string {
  const goals: string[] = ['Fix grammar, spelling, and awkward phrasing.']
  if (options.clarity) goals.push('Maximize clarity and remove ambiguity.')
  if (options.structure) goals.push('Give the prompt a clean structure (role, task, context, constraints, output format) when it helps.')
  if (options.bestPractices) goals.push('Apply prompt-engineering best practices: explicit instructions, concrete constraints, and a clearly specified output format.')
  if (options.tokenEfficiency) goals.push('Be concise — cut filler and redundancy to reduce token usage without losing meaning or quality.')
  if (options.preserveIntent) goals.push('Preserve the original intent, requirements, and all factual details exactly.')

  const lines = [
    'You are an expert prompt engineer. Rewrite the prompt the user gives you into a higher-quality prompt for an LLM or AI agent.',
    ...goals.map((g) => `- ${g}`),
    `Write the enhanced prompt in ${outputLanguage || 'English'}, regardless of the input language.`,
  ]
  if (instruction?.trim()) {
    lines.push(
      'The user also gave this instruction about how to enhance the prompt. It takes priority over the goals above — apply it faithfully, and treat it as guidance for the rewrite, NOT as content to answer or to insert verbatim:',
      `"""${instruction.trim()}"""`,
    )
  }
  lines.push('Return ONLY the enhanced prompt text — no preamble, no explanations, no surrounding quotes or code fences.')
  return lines.join('\n')
}

export async function enhancePrompt(
  provider: Provider,
  modelId: string,
  prompt: string,
  options: EnhanceOptions,
  outputLanguage: string,
  instruction?: string,
  onDelta?: (chunk: string, fullText: string) => void,
): Promise<string> {
  const res = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(provider),
    body: JSON.stringify({
      model: modelId,
      stream: true,
      messages: [
        { role: 'system', content: buildSystemPrompt(options, outputLanguage, instruction) },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`Provider error (HTTP ${res.status}): ${await safeError(res)}`)
  }
  const text = res.headers.get('content-type')?.includes('text/event-stream')
    ? await readSseStream(res, onDelta)
    : extractCompletionText(await res.json())
  if (!text.trim()) {
    throw new Error('The model returned an empty response.')
  }
  return text.trim()
}

/** Some providers ignore `stream: true` and return plain JSON — handle both. */
function extractCompletionText(data: unknown): string {
  const text = (data as any)?.choices?.[0]?.message?.content
  return typeof text === 'string' ? text : ''
}

async function readSseStream(
  res: Response,
  onDelta?: (chunk: string, fullText: string) => void,
): Promise<string> {
  if (!res.body) throw new Error('The provider response has no body to stream.')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let event: any
    try {
      event = JSON.parse(payload)
    } catch {
      return // ignore malformed keep-alive / partial frames
    }
    if (event?.error) {
      throw new Error(event.error.message ?? 'The provider reported a streaming error.')
    }
    const chunk = event?.choices?.[0]?.delta?.content
    if (typeof chunk === 'string' && chunk) {
      fullText += chunk
      onDelta?.(chunk, fullText)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line.trim())
  }
  buffer += decoder.decode()
  if (buffer.trim()) handleLine(buffer.trim())
  return fullText
}

async function safeError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body?.error?.message ?? res.statusText
  } catch {
    return res.statusText
  }
}

function describeNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return `Request failed (${msg}). Check the base URL, your network, and that the provider allows browser (CORS) requests.`
}
