/**
 * OpenAI-compatible provider stub for the smoke test. Behaviour is chosen by
 * model id so one server covers every path the app has to handle:
 *
 *   slow  — streams a reasoning chunk, then 40 content chunks over ~2 s
 *   fail  — HTTP 500 with an error body
 *   hang  — sends SSE headers and then nothing (cancel / idle-timeout path)
 *   split — one JSON payload spread over several `data:` lines
 */
import http from 'node:http'

export const MOCK_PORT = 4174

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export function startMockProvider(port = MOCK_PORT) {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      return res.end()
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({ data: [{ id: 'slow' }, { id: 'fail' }, { id: 'hang' }, { id: 'split' }] }),
      )
    }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404, CORS)
      return res.end()
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const { model } = JSON.parse(body || '{}')
      if (model === 'fail') {
        res.writeHead(500, { ...CORS, 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: 'mock failure' } }))
      }
      res.writeHead(200, {
        ...CORS,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      })
      if (model === 'hang') return // headers only; never completes
      if (model === 'split') {
        res.write('data: {"choices":[{"delta":\ndata: {"content":"# Enhanced\\n\\nsplit ok"}}]}\n\n')
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
      let i = 0
      send({ reasoning_content: 'Let me think about this prompt. ' })
      const timer = setInterval(() => {
        if (res.destroyed) return clearInterval(timer)
        i += 1
        if (i <= 40) {
          if (i === 1) send({ content: '# Enhanced\n\n' })
          send({ content: `word${i} ` })
        } else {
          clearInterval(timer)
          res.write('data: [DONE]\n\n')
          res.end()
        }
      }, 50)
      // The response, not the request, is what ends when the client aborts.
      res.on('close', () => clearInterval(timer))
    })
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMockProvider().then(() => console.log(`mock provider on http://localhost:${MOCK_PORT}`))
}
