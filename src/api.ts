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

function buildSystemPrompt(options: EnhanceOptions, outputLanguage: string): string {
  const goals: string[] = ['Fix grammar, spelling, and awkward phrasing.']
  if (options.clarity) goals.push('Maximize clarity and remove ambiguity.')
  if (options.structure) goals.push('Give the prompt a clean structure (role, task, context, constraints, output format) when it helps.')
  if (options.bestPractices) goals.push('Apply prompt-engineering best practices: explicit instructions, concrete constraints, and a clearly specified output format.')
  if (options.tokenEfficiency) goals.push('Be concise — cut filler and redundancy to reduce token usage without losing meaning or quality.')
  if (options.preserveIntent) goals.push('Preserve the original intent, requirements, and all factual details exactly.')

  return [
    'You are an expert prompt engineer. Rewrite the prompt the user gives you into a higher-quality prompt for an LLM or AI agent.',
    ...goals.map((g) => `- ${g}`),
    `Write the enhanced prompt in ${outputLanguage || 'English'}, regardless of the input language.`,
    'Return ONLY the enhanced prompt text — no preamble, no explanations, no surrounding quotes or code fences.',
  ].join('\n')
}

export async function enhancePrompt(
  provider: Provider,
  modelId: string,
  prompt: string,
  options: EnhanceOptions,
  outputLanguage: string,
): Promise<string> {
  const res = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(provider),
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: buildSystemPrompt(options, outputLanguage) },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`Provider error (HTTP ${res.status}): ${await safeError(res)}`)
  }
  const data = await res.json()
  const text: unknown = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('The model returned an empty response.')
  }
  return text.trim()
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
