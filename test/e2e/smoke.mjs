/**
 * End-to-end smoke checks against the built app and a stub provider.
 * Covers the paths unit tests can't reach: persistence timing, the chain
 * viewport, streaming, cancel/failure recovery, and multi-tab merging.
 *
 * Run with `npm run smoke` (see run.mjs, which starts both servers).
 */
import { chromium } from 'playwright-core'
import { PROVIDERS, SESSIONS, column, session } from './fixtures.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:4173/'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

/** Seeded page in a fresh context, with a counter for pe.sessions writes. */
async function open(browser, { viewport = { width: 1440, height: 900 }, active = 'big', sessions = SESSIONS, raw = null, context = null } = {}) {
  const ctx = context ?? (await browser.newContext({ viewport }))
  if (!context) {
    await ctx.addInitScript(
      ({ providers, sessions, active, raw }) => {
        localStorage.clear()
        localStorage.setItem('pe.providers', JSON.stringify(providers))
        localStorage.setItem('pe.sessions', raw ?? JSON.stringify(sessions))
        localStorage.setItem('pe.activeSession', active)
        localStorage.setItem('pe.theme', 'light')
        window.__writes = 0
        const orig = Storage.prototype.setItem
        Storage.prototype.setItem = function (k, v) {
          if (k === 'pe.sessions') window.__writes += 1
          if (window.__failWrites) throw new DOMException('quota', 'QuotaExceededError')
          return orig.call(this, k, v)
        }
      },
      { providers: PROVIDERS, sessions, active, raw },
    )
  }
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    // The stub deliberately returns 500 / stalls on some models.
    if (text.startsWith('Failed to load resource')) return
    errors.push(text)
  })
  await page.goto(APP)
  await page.waitForSelector('.chain-slot')
  return { ctx, page, errors }
}

const slots = (page) =>
  page.$$eval('.chain-slot', (els) =>
    els.map((el) => ({ inert: el.hasAttribute('inert'), past: el.getAttribute('data-past') })),
  )
const storedChain = (page, id) =>
  page.evaluate(
    (sid) =>
      JSON.parse(localStorage.getItem('pe.sessions'))
        .find((s) => s.id === sid)
        .chain.map((c) => c.id),
    id,
  )

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  /* ---- Desktop: boot, mount window, persistence, preview, navigation ---- */
  {
    const { ctx, page, errors } = await open(browser)
    check('boots with one slot per link', (await slots(page)).length === 20)
    const mounted = await page.locator('.chain-card').count()
    check('mounts only the view window, not the whole chain', mounted >= 2 && mounted <= 4, `${mounted} of 20 cards`)
    const first = await slots(page)
    check('off-screen columns are inert', first.slice(2).every((s) => s.inert) && !first[0].inert && !first[1].inert)

    const before = await page.evaluate(() => window.__writes)
    const ta = page.locator('.chain-card').first().locator('textarea').first()
    await ta.click()
    await ta.press('End')
    await page.keyboard.type(' typed-marker-xyz', { delay: 8 })
    const during = await page.evaluate(() => window.__writes)
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => window.__writes)
    check('typing 17 characters writes at most once mid-burst', during - before <= 1, `${during - before} writes`)
    check('one debounced write lands after the pause', after - before === 1, `${after - before} total`)
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('pe.sessions')).find((s) => s.id === 'big').chain[0].text,
    )
    check('typed text reached storage', stored.includes('typed-marker-xyz'))

    await page.locator('.chain-card').first().locator('.card').first().click()
    await page.waitForTimeout(250)
    check('preview renders the selected column', (await page.$eval('.markdown-body', (el) => el.textContent)).includes('typed-marker-xyz'))

    // Advanced panel: opens, keeps its select values, and is not persisted.
    await page.locator('.chain-card').first().getByRole('button', { name: /Advanced settings/ }).click()
    await page.waitForTimeout(250)
    const selects = await page.locator('.advanced-panel select').first().inputValue()
    check('advanced panel selects show the stored provider', selects === 'p1', `value=${selects}`)
    const persistedFlags = await page.evaluate(() =>
      JSON.stringify(localStorage.getItem('pe.sessions')).includes('showAdvanced'),
    )
    check('panel state is not written to storage', !persistedFlags)

    await page.keyboard.press('Escape')
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(
      () => document.querySelector('.chain-track').style.getPropertyValue('--view-index').trim() === '1',
    )
    const slid = await slots(page)
    check('ArrowRight slides one step and moves the inert window', slid[0].inert && slid[0].past === 'true' && !slid[1].inert)

    const switchMs = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const btn = [...document.querySelectorAll('aside button')].find((b) => b.textContent.includes('Filler 3'))
          const t = performance.now()
          btn.click()
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t)))
        }),
    )
    check('session switch stays inside a two-frame budget', switchMs < 100, `${switchMs.toFixed(1)} ms`)

    await page.evaluate(() => {
      window.__failWrites = true
    })
    await page.locator('.chain-slot:not([inert]) textarea').first().click()
    await page.keyboard.type('x')
    await page.waitForTimeout(400)
    const alert = await page.$eval('[role="alert"]', (el) => ({ shown: getComputedStyle(el).display !== 'none', text: el.textContent })).catch(() => ({ shown: false, text: '' }))
    check('a failed write raises the storage banner', alert.shown && alert.text.includes('could not be saved'))
    await page.evaluate(() => {
      window.__failWrites = false
    })
    await page.keyboard.type('y')
    await page.waitForTimeout(400)
    check('banner clears once a write succeeds', await page.$eval('[role="alert"]', (el) => getComputedStyle(el).display === 'none'))
    check('no page errors in the desktop flow', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  /* ---- Narrow viewport: the newest link must be reachable ---- */
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 390, height: 800 } })
    const start = await slots(page)
    check('phone: the peeked next column stays tappable', !start[1].inert && start.slice(2).every((s) => s.inert))
    for (let i = 0; i < 25; i++) await page.locator('button[title^="Later links"]').click({ force: true })
    await page.waitForTimeout(60)
    const index = await page.$eval('.chain-track', (el) => el.style.getPropertyValue('--view-index').trim())
    const last = (await slots(page))[19]
    check('phone: the newest link can lead the viewport', index === '19' && !last.inert, `view-index=${index}`)
    check('no page errors in the phone flow', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  /* ---- Unreadable stored data is parked, not overwritten ---- */
  {
    const { ctx, page, errors } = await open(browser, { raw: '{not json at all' })
    const notice = await page.$eval('div[role="status"]', (el) => el.textContent).catch(() => '')
    check('a corrupt sessions blob shows a notice', notice.includes('could not be read'))
    const kept = await page.evaluate(() => localStorage.getItem('pe.sessions'))
    check('the corrupt blob is left in place, not replaced', kept === '{not json at all')
    const parked = await page.evaluate(() => localStorage.getItem('pe.sessions.quarantine'))
    check('a copy is parked under the quarantine key', Boolean(parked) && parked.includes('not json'))
    check('the app still boots with an empty session', (await slots(page)).length === 1)
    check('no page errors on the corrupt-data path', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  /* ---- One damaged session must not take the others down ---- */
  {
    // A record with a damaged field is repaired in place; only one that isn't
    // a session at all gets set aside.
    const damaged = [
      session('ok1', 2, 'm-slow', 'Fine one'),
      { id: 'repairable', chain: [{ id: 'x', text: 'kept', settings: 'not an object' }] },
      null,
      'this is not a session',
      session('ok2', 2, 'm-slow', 'Fine two'),
    ]
    const { ctx, page, errors } = await open(browser, { active: 'ok1', sessions: damaged })
    const titles = await page.$$eval('aside button', (els) => els.map((e) => e.textContent))
    check('readable sessions still open', titles.some((t) => t.includes('Fine one')) && titles.some((t) => t.includes('Fine two')))
    const repaired = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('pe.sessions')).find((s) => s.id === 'repairable'),
    )
    check('a repairable record is fixed in place, not discarded', repaired?.chain?.[0]?.text === 'kept' && typeof repaired.chain[0].settings === 'object')
    const notice = await page.$eval('div[role="status"]', (el) => el.textContent).catch(() => '')
    check('unusable records are reported', notice.includes('set aside'))
    const parked = await page.evaluate(() => localStorage.getItem('pe.sessions.quarantine'))
    check('unusable records are parked', Boolean(parked) && parked.includes('not a session'))
    check('no page errors on the damaged-record path', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  /* ---- A failed enhancement restores the links it replaced ---- */
  {
    const { ctx, page, errors } = await open(browser, { active: 'four' })
    const before = await storedChain(page, 'four')
    await page.locator('.chain-column').nth(1).locator('button.btn-primary').click({ force: true })
    await page.waitForSelector('[role="alert"][x-show="error"]', { state: 'visible' })
    await page.waitForTimeout(400)
    check('a failed enhancement restores every later link', JSON.stringify(await storedChain(page, 'four')) === JSON.stringify(before), `${before.length} links`)
    check('the provider error is shown', (await page.$eval('[role="alert"][x-show="error"]', (el) => el.textContent)).includes('mock failure'))
    check('no page errors on the failure path', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  /* ---- Cancel restores; a successful run streams into a new link ---- */
  {
    const { ctx, page, errors } = await open(browser, { active: 'cancel' })
    const before = await storedChain(page, 'cancel')
    await page.locator('.chain-column').nth(1).locator('button.btn-primary').click({ force: true })
    const cancel = page.locator('.chain-card button:has-text("Cancel"):visible')
    await cancel.waitFor({ state: 'visible' })
    check('exactly one Enhance button shows the spinner', (await page.locator('.animate-spin:visible').count()) === 1)

    // The preview must keep up with the stream. A plain trailing debounce is
    // starved by per-frame chunks and renders nothing until the response ends.
    const previewSizes = []
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(220)
      previewSizes.push(await page.evaluate(() => document.querySelector('.markdown-body')?.textContent.length ?? 0))
    }
    check(
      'the preview renders progressively while the response streams',
      new Set(previewSizes).size > 2 && previewSizes.at(-1) > 0,
      previewSizes.join(' → '),
    )
    check(
      'the streaming column rejects edits',
      await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.chain-card')]
        return cards.some((c) => c.querySelector('textarea')?.readOnly === true)
      }),
    )
    await page.waitForTimeout(300)
    await cancel.click({ force: true })
    await page.waitForTimeout(400)
    check('cancel restores the chain', JSON.stringify(await storedChain(page, 'cancel')) === JSON.stringify(before))
    check('cancel reports no error', !(await page.$eval('[role="alert"][x-show="error"]', (el) => getComputedStyle(el).display !== 'none')))
    check('Enhance is usable again after cancel', await page.locator('.chain-column').nth(1).locator('button.btn-primary').isEnabled())

    await page.locator('.chain-column').nth(1).locator('button.btn-primary').click({ force: true })
    await page.waitForFunction(
      () => {
        const s = JSON.parse(localStorage.getItem('pe.sessions')).find((x) => x.id === 'cancel')
        return s.chain.length === 3 && s.chain[2].text.endsWith('word40')
      },
      null,
      { timeout: 20000 },
    )
    const chain = await page.evaluate(() => JSON.parse(localStorage.getItem('pe.sessions')).find((s) => s.id === 'cancel').chain)
    check('the streamed text is saved on a new link', chain[2].text.startsWith('# Enhanced'))
    check('reasoning is captured', chain[2].reasoning.includes('Let me think'))
    check('reasoning seconds are recorded', chain[2].reasoningSeconds >= 0)
    check('the view slid to show source and result', (await page.$eval('.chain-track', (el) => el.style.getPropertyValue('--view-index').trim())) === '1')
    await page.waitForTimeout(300)
    check('the preview rendered the new link', (await page.$eval('.markdown-body', (el) => el.innerHTML)).includes('<h1>Enhanced</h1>'))
    const label = await page.evaluate(() => {
      const span = [...document.querySelectorAll('button.btn-primary span')].find((s) => s.textContent.includes('Enhance →'))
      return span ? { text: span.textContent.trim(), clipped: span.scrollWidth > span.clientWidth + 1 } : null
    })
    check('the Enhance label is not truncated', label && !label.clipped, label?.text)
    check('no page errors on the cancel/success path', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  /* ---- The primary action stays reachable however short the column gets ---- */
  {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 820, height: 900 },
      { width: 390, height: 780 },
    ]) {
      const { ctx, page } = await open(browser, { viewport, active: 'four' })
      // Open the advanced overlay too: it is the one thing tall enough to
      // cover the action row, and it did when that row was sticky inside
      // the scrolling card.
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Advanced settings/.test(x.textContent))
        b.click()
      })
      await page.waitForTimeout(400)
      const state = await page.evaluate(() => {
        const column = document.querySelector('.chain-column')
        const btn = [...column.querySelectorAll('button')].find((b) => /Enhance →/.test(b.textContent))
        // Below md the page itself scrolls, so bring the button into the
        // window before hit-testing; what matters is that nothing covers it.
        btn.scrollIntoView({ block: 'center' })
        const box = column.getBoundingClientRect()
        const r = btn.getBoundingClientRect()
        // Hit-test the button's own centre: on screen is not enough, it has
        // to be the element the pointer would actually reach.
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return {
          hidden: Math.round(Math.max(0, r.bottom - box.bottom)),
          reachable: btn === hit || btn.contains(hit),
          covering: btn === hit || btn.contains(hit) ? '' : (hit?.className || hit?.tagName || '?').toString().slice(0, 30),
        }
      })
      check(
        `Enhance stays visible and clickable at ${viewport.width}×${viewport.height}`,
        state.hidden === 0 && state.reachable,
        state.reachable ? `${state.hidden}px hidden` : `covered by ${state.covering}`,
      )
      await ctx.close()
    }
  }

  /* ---- Two tabs share storage: merge instead of last-write-wins ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(
      ({ providers, sessions }) => {
        localStorage.clear()
        localStorage.setItem('pe.providers', JSON.stringify(providers))
        localStorage.setItem('pe.sessions', JSON.stringify(sessions))
        localStorage.setItem('pe.activeSession', 'a')
        localStorage.setItem('pe.theme', 'light')
      },
      { providers: PROVIDERS, sessions: [session('a', 1, 'm-slow', 'Tab A'), session('b', 1, 'm-slow', 'Tab B')] },
    )
    const a = await ctx.newPage()
    a.on('dialog', (d) => d.accept())
    await a.goto(APP)
    await a.waitForSelector('.chain-slot')
    const b = await ctx.newPage()
    b.on('dialog', (d) => d.accept())
    await b.goto(APP)
    await b.waitForSelector('.chain-slot')

    // Tab B creates a session; tab A must pick it up without losing its own.
    await b.locator('aside button:has-text("+ New")').click()
    await b.waitForTimeout(300)
    await a.waitForFunction(() => {
      const el = [...document.querySelectorAll('aside')].map((x) => x.textContent).join(' ')
      return el.includes('New session')
    }, null, { timeout: 5000 }).catch(() => {})
    const aTitles = await a.$$eval('aside button', (els) => els.map((e) => e.textContent).join(' '))
    check('a session created in another tab appears here', aTitles.includes('New session') && aTitles.includes('Tab A'))

    // Tab A deletes "Tab B"; the tombstone must stop B writing it back.
    const row = a.locator('aside li').filter({ hasText: 'Tab B' }).first()
    await row.hover()
    await row.getByTitle('Delete session').click()
    await a.waitForTimeout(400)
    await b.waitForTimeout(400)
    // Force B to save, which would resurrect the deleted session if the
    // tombstone were not applied.
    await b.locator('.chain-slot:not([inert]) textarea').first().click()
    await b.keyboard.type('edit in B')
    await b.waitForTimeout(500)
    const finalIds = await a.evaluate(() => JSON.parse(localStorage.getItem('pe.sessions')).map((s) => s.title))
    check('a session deleted here is not resurrected by the other tab', !finalIds.includes('Tab B'), finalIds.join(', '))
    await ctx.close()
  }
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
