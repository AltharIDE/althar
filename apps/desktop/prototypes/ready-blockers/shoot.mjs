// Shoots the prototype's pages, headless, while its server runs: node prototypes/ready-blockers/shoot.mjs [page]
// from apps/desktop, outside the sandbox (Chromium can't start in it). Each [data-shot] figure is one shot.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5371'
const OUT = join(import.meta.dirname, 'shots')
mkdirSync(OUT, { recursive: true })

const NAME = { 1: 'states', 2: 'board', 3: 'home', 4: 'checks-bug' }
const only = process.argv[2]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 })
let errors = 0
page.on('console', (m) => m.type() === 'error' && (errors++, console.error('  console:', m.text().slice(0, 400))))
page.on('pageerror', (e) => (errors++, console.error('  pageerror:', e.message.slice(0, 400))))

for (const key of ['today', 'a', 'b', 'c', 'd', 'e', 'index']) {
  if (only !== undefined && key !== only) continue
  await page.goto(`${BASE}/${key}.html`)
  await page.waitForSelector('[data-shot]')
  // The home reads its fake runtime, then each line arrives on its own.
  await page.waitForTimeout(2500)
  await page.mouse.move(0, 0)
  for (const shot of await page.locator('[data-shot]').all()) {
    const label = await shot.getAttribute('data-shot')
    const name = key === 'index' ? `${label}-compare` : `${label}-${NAME[label.slice(1)]}`
    await shot.screenshot({ path: join(OUT, `${name}.png`) })
    console.error(name)
  }
  if (key === 'index') {
    await page.screenshot({ path: join(OUT, 'X0-compare-page.png'), fullPage: true })
    console.error('X0-compare-page')
  }
}
await browser.close()
console.error(errors === 0 ? 'no errors' : `${errors} errors`)
