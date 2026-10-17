// Scrappy: every direction on both screens, held 6s into a 20s gap, headless: what each shows of the wait, and a shot of each
// into shots/ (git ignores it). The app's own Thinking (C, built) must show nowhere but as C's own placeholder, and today must
// be as it was: no Thinking, the previous reply at work again. node replay.mjs, with the server up, outside the agent sandbox.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../package.json'))
const { chromium } = require('@playwright/test')

const out = resolve(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
let wrong = 0
for (const d of ['T', 'A', 'B', 'C', 'D', 'E']) {
  for (const v of ['coordinator', 'task']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 120)))
    await page.goto(`http://localhost:5397/?d=${d}&v=${v}&delay=20&at=6`)
    await page.waitForTimeout(4500)
    const seen = await page.evaluate(() => {
      const thread = document.querySelector('[aria-label="Conversation"], [aria-label="Thread"]')
      const text = thread?.textContent ?? ''
      return {
        // The kit's Thinking line, wherever it is: the app's, or C's placeholder.
        thinking: document.querySelectorAll('[class*="Reasoning-module__thinking"]').length,
        working: /Working( for|\s·)/.test(text),
        overlay: document.querySelector('vite-error-overlay') !== null,
      }
    })
    const expected = { thinking: d === 'C' ? 1 : 0, working: d === 'T' }
    const ok = errors.length === 0 && !seen.overlay && seen.thinking === expected.thinking && seen.working === expected.working
    if (!ok) wrong += 1
    process.stdout.write(
      `${ok ? 'ok  ' : 'WRONG'} ${d} ${v.padEnd(11)} kit Thinking ×${seen.thinking}  previous reply at work: ${seen.working ? 'yes' : 'no '}` +
        `${errors.length === 0 && !seen.overlay ? '' : `  errors: ${errors.join(' | ') || 'overlay'}`}\n`,
    )
    await page.screenshot({ path: resolve(out, `replay-${d}-${v}.png`), clip: { x: 380, y: 400, width: 680, height: 300 } })
    await page.close()
  }
}
// Today's flash of Queued, 0.2s in, while the store's copy is queued and the agent idle, stays; no direction has it.
for (const d of ['T', 'A', 'C']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:5397/?d=${d}&v=coordinator&delay=20&at=0.2`)
  await page.waitForTimeout(3000)
  const queued = await page
    .getByText('Queued · the coordinator reads it next')
    .evaluateAll((found) => found.some((element) => element.getClientRects().length > 0 && Number(getComputedStyle(element).opacity) > 0))
  const ok = queued === (d === 'T')
  if (!ok) wrong += 1
  process.stdout.write(`${ok ? 'ok  ' : 'WRONG'} ${d} coordinator 0.2s in: Queued shown: ${queued ? 'yes' : 'no'}\n`)
  await page.close()
}
await browser.close()
process.exit(wrong === 0 ? 0 : 1)
