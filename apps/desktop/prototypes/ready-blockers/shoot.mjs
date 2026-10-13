// Shoots the prototype's pages, headless: node prototypes/ready-blockers/shoot.mjs [only-page]. Run outside the sandbox.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5352'
const OUT = join(import.meta.dirname, '../../test-results/ready-blockers')
mkdirSync(OUT, { recursive: true })

const NAME = { 1: 'states', 2: 'board', 3: 'home' }
const only = process.argv[2]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1720, height: 1000 }, deviceScaleFactor: 2 })
page.on('console', (m) => m.type() === 'error' && console.error('  console:', m.text().slice(0, 300)))
page.on('pageerror', (e) => console.error('  pageerror:', e.message.slice(0, 300)))

for (const key of ['today', 'a', 'b', 'c', 'd']) {
  if (only !== undefined && key !== only) continue
  await page.goto(`${BASE}/${key}.html`)
  await page.waitForSelector('[data-shot]')
  await page.waitForTimeout(1200)
  for (const shot of await page.locator('[data-shot]').all()) {
    const label = await shot.getAttribute('data-shot')
    const name = `${label}-${NAME[label.slice(1)]}`
    console.error(name)
    await shot.screenshot({ path: join(OUT, `${name}.png`) })
  }
  // B: what a chip says, on hover.
  if (key === 'b') {
    const chip = page.locator('[data-shot="B1"] [aria-label^="Conflicts with main"]').first()
    await chip.hover()
    await page.waitForTimeout(600)
    const card = page.locator('[data-shot="B1"] figure').nth(3)
    const box = await card.boundingBox()
    await page.screenshot({
      path: join(OUT, 'B4-tooltip.png'),
      clip: { x: box.x - 10, y: box.y - 60, width: box.width + 200, height: box.height + 70 },
    })
    console.error('B4-tooltip')
  }
}

if (only === undefined || only === 'index') {
  await page.goto(`${BASE}/index.html`)
  await page.waitForSelector('[data-shot]')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: join(OUT, 'X-compare.png'), fullPage: true })
  console.error('X-compare')
}
await browser.close()
