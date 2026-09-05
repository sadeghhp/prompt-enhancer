/**
 * Start the preview server and the provider stub, run the smoke checks, then
 * shut both down. `npm run smoke` (build first, or pass an existing APP_URL).
 *
 * A Chrome/Chromium binary is required: set CHROME_PATH, or let this pick one
 * up from the usual locations / a Playwright browser cache.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { startMockProvider } from './mock-provider.mjs'

const APP_PORT = 4173
const APP_URL = `http://localhost:${APP_PORT}/`

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  for (const path of candidates) if (existsSync(path)) return path
  // Playwright's own cache, e.g. ~/.cache/ms-playwright/chromium-1234/chrome-linux/chrome
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      for (const rel of [
        ['chrome-linux', 'chrome'],
        ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
        ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
      ]) {
        const path = join(cache, dir, ...rel)
        if (existsSync(path)) return path
      }
    }
  }
  return null
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const chrome = findChrome()
if (!chrome) {
  console.error('No Chrome/Chromium found. Set CHROME_PATH to a browser binary and re-run.')
  process.exit(1)
}

const preview = spawn('npx', ['vite', 'preview', '--port', String(APP_PORT), '--strictPort'], {
  stdio: 'ignore',
})
const mock = await startMockProvider()

let code = 1
try {
  await waitForServer(APP_URL)
  const smoke = spawn('node', [new URL('./smoke.mjs', import.meta.url).pathname], {
    stdio: 'inherit',
    env: { ...process.env, CHROME_PATH: chrome, APP_URL },
  })
  code = await new Promise((resolve) => smoke.on('exit', resolve))
} finally {
  preview.kill()
  mock.close()
}
process.exit(code ?? 1)
