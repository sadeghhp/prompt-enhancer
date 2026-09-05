import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnhanceCancelledError, enhancePrompt } from './api'
import type { DeltaKind } from './api'
import type { Provider } from './types'

const provider: Provider = {
  id: 'p',
  name: 'Test',
  baseUrl: 'https://example.test/v1/',
  apiKey: 'k',
  models: [{ id: 'm', modelId: 'test-model', label: '' }],
}

const context = {
  options: {
    clarity: true,
    structure: true,
    bestPractices: true,
    tokenEfficiency: true,
    preserveIntent: true,
    brevity: false,
    commentary: false,
  },
  outputLanguage: 'English',
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function contentDelta(text: string) {
  return { choices: [{ delta: { content: text } }] }
}

function reasoningDelta(text: string) {
  return { choices: [{ delta: { reasoning_content: text } }] }
}

/**
 * Build a streaming Response from raw byte chunks. `onCancel` observes
 * reader.cancel(); `hang` keeps the stream open after the given chunks so
 * abort / idle-timeout paths can be exercised. Like a real fetch body, the
 * stream errors with AbortError when `signal` aborts.
 */
function sseResponse(
  chunks: string[],
  opts: { onCancel?: () => void; hang?: boolean; signal?: AbortSignal | null } = {},
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      if (!opts.hang) controller.close()
      opts.signal?.addEventListener('abort', () =>
        controller.error(new DOMException('The operation was aborted.', 'AbortError')),
      )
    },
    cancel() {
      opts.onCancel?.()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

type Delta = [string, string, DeltaKind]

describe('enhancePrompt (SSE)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reassembles frames split across chunks and stops at [DONE]', async () => {
    const frames = sse(contentDelta('Hel')) + sse(contentDelta('lo')) + 'data: [DONE]\n\n'
    // Split in the middle of a JSON payload to exercise line buffering.
    const cut = frames.indexOf('lo') - 3
    const deltas: Delta[] = []
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([frames.slice(0, cut), frames.slice(cut)])))

    const text = await enhancePrompt(provider, 'test-model', 'hi', context, (c, f, k) =>
      deltas.push([c, f, k]),
    )
    expect(text).toBe('Hello')
    expect(deltas).toEqual([
      ['Hel', 'Hel', 'content'],
      ['lo', 'Hello', 'content'],
    ])
  })

  it('separates reasoning from content and trims the result', async () => {
    const frames = sse(reasoningDelta('think ')) + sse(contentDelta('  answer  '))
    const kinds: DeltaKind[] = []
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([frames])))
    const text = await enhancePrompt(provider, 'test-model', 'hi', context, (_c, _f, k) =>
      kinds.push(k),
    )
    expect(text).toBe('answer')
    expect(kinds).toEqual(['reasoning', 'content'])
  })

  it('posts to the normalized chat/completions URL with auth and stream:true', async () => {
    const fetchMock = vi.fn(async () => sseResponse([sse(contentDelta('x'))]))
    vi.stubGlobal('fetch', fetchMock)
    await enhancePrompt(provider, 'test-model', 'hi', context)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.test/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'test-model', stream: true })
  })

  it('surfaces a streamed error object and releases the reader', async () => {
    const onCancel = vi.fn()
    const frames = sse(contentDelta('partial')) + sse({ error: { message: 'boom' } })
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([frames], { onCancel, hang: true })))
    await expect(enhancePrompt(provider, 'test-model', 'hi', context)).rejects.toThrow('boom')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: [DONE]\n\n'])))
    await expect(enhancePrompt(provider, 'test-model', 'hi', context)).rejects.toThrow(
      'empty response',
    )
  })

  it('reports HTTP errors with the provider message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'bad key' } }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await expect(enhancePrompt(provider, 'test-model', 'hi', context)).rejects.toThrow(
      'Provider error (HTTP 401): bad key',
    )
  })

  it('handles providers that ignore stream:true and return JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'plain', reasoning: 'why' } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    const deltas: Delta[] = []
    const text = await enhancePrompt(provider, 'test-model', 'hi', context, (c, f, k) =>
      deltas.push([c, f, k]),
    )
    expect(text).toBe('plain')
    expect(deltas).toEqual([['why', '', 'reasoning']])
  })
})

describe('enhancePrompt cancellation and timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** A fetch that honours its AbortSignal and otherwise never resolves. */
  function hangingFetch(onAbort?: () => void) {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            onAbort?.()
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    )
  }

  it('throws EnhanceCancelledError when the caller aborts', async () => {
    const onAbort = vi.fn()
    vi.stubGlobal('fetch', hangingFetch(onAbort))
    const ctrl = new AbortController()
    const p = enhancePrompt(provider, 'test-model', 'hi', context, undefined, ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toBeInstanceOf(EnhanceCancelledError)
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('throws immediately if the signal is already aborted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      enhancePrompt(provider, 'test-model', 'hi', context, undefined, ctrl.signal),
    ).rejects.toBeInstanceOf(EnhanceCancelledError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('times out when the provider never sends headers', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const p = enhancePrompt(provider, 'test-model', 'hi', context)
    const assertion = expect(p).rejects.toThrow('stopped responding for 30 seconds')
    await vi.advanceTimersByTimeAsync(30_001)
    await assertion
  })

  it('times out when a stream stalls between chunks', async () => {
    let signal: AbortSignal | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? null
        return sseResponse([sse(contentDelta('first'))], { hang: true, signal })
      }),
    )
    const deltas: string[] = []
    const p = enhancePrompt(provider, 'test-model', 'hi', context, (c) => deltas.push(c))
    const assertion = expect(p).rejects.toThrow('stopped responding for 90 seconds')
    await vi.advanceTimersByTimeAsync(90_001)
    await assertion
    expect(deltas).toEqual(['first'])
    // The fetch itself was aborted, which is what frees the connection.
    expect(signal!.aborted).toBe(true)
  })

  it('cancelling mid-stream aborts the fetch and throws EnhanceCancelledError', async () => {
    let signal: AbortSignal | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? null
        return sseResponse([sse(contentDelta('partial'))], { hang: true, signal })
      }),
    )
    const ctrl = new AbortController()
    const p = enhancePrompt(provider, 'test-model', 'hi', context, undefined, ctrl.signal)
    const assertion = expect(p).rejects.toBeInstanceOf(EnhanceCancelledError)
    await vi.advanceTimersByTimeAsync(10)
    ctrl.abort()
    await assertion
    expect(signal!.aborted).toBe(true)
  })

  it('does not fire the connect timeout once the stream has started', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) =>
        sseResponse([sse(contentDelta('ok'))], { hang: true, signal: init.signal }),
      ),
    )
    const p = enhancePrompt(provider, 'test-model', 'hi', context)
    let settled = false
    p.then(
      () => (settled = true),
      () => (settled = true),
    )
    await vi.advanceTimersByTimeAsync(31_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(p).rejects.toThrow('90 seconds')
  })
})
