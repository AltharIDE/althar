// Shoots the prototype's pages, headless: node prototypes/agent-queue/shoot.mjs [only-page]. Run outside the sandbox.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5356'
const OUT = join(import.meta.dirname, '../../test-results/agent-queue')
mkdirSync(OUT, { recursive: true })

const NAME = { 1: 'one', 2: 'three', 3: 'planned-held', 4: 'under-way', 5: 'agent-frees', 6: 'dock', 7: 'task', 8: 'home' }
const only = process.argv[2]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1720, height: 1000 }, deviceScaleFactor: 2 })
page.on('console', (m) => m.type() === 'error' && console.error('  console:', m.text().slice(0, 300)))
page.on('pageerror', (e) => console.error('  pageerror:', e.message.slice(0, 300)))

for (const key of ['today', 'a', 'b', 'c', 'd', 'e']) {
  if (only !== undefined && key !== only) continue
  await page.goto(`${BASE}/${key}.html`)
  await page.waitForSelector('[data-shot]')
  await page.waitForTimeout(1500)
  for (const shot of await page.locator('[data-shot]').all()) {
    const label = await shot.getAttribute('data-shot')
    const name = `${label}-${NAME[label.slice(1)]}`
    console.error(name)
    await shot.screenshot({ path: join(OUT, `${name}.png`) })
  }
}

if (only === undefined || only === 'index') {
  await page.goto(`${BASE}/index.html`)
  await page.waitForSelector('[data-shot]')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(OUT, 'X-compare.png'), fullPage: true })
  console.error('X-compare')
}
await browser.close()
