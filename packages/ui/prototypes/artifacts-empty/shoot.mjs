// Scrappy: the screenshots, headless at 1×, into test-results/artifacts-empty: node shoot.mjs  (outside the sandbox, the server running)
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const { chromium } = createRequire(resolve(repo, 'apps/desktop/package.json'))('@playwright/test')
const out = resolve(repo, 'test-results/artifacts-empty')
mkdirSync(out, { recursive: true })

const SHOTS = []
let n = 1
for (const d of ['now', 'D1', 'D2', 'D3', 'D4']) {
  SHOTS.push({ id: `${String(n++).padStart(2, '0')}-${d}-wide-light`, q: `d=${d}&s=both&w=wide&t=light`, width: 2000 })
  SHOTS.push({ id: `${String(n++).padStart(2, '0')}-${d}-narrow-dark`, q: `d=${d}&s=both&w=narrow&t=dark`, width: 1180 })
}

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1280, height: 760 } })
for (const shot of SHOTS) {
  await page.setViewportSize({ width: shot.width, height: 760 })
  await page.goto(`http://localhost:5386/?${shot.q}`)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.locator('main').screenshot({ path: resolve(out, `${shot.id}.png`) })
  process.stdout.write(`${shot.id}\n`)
}
await browser.close()
