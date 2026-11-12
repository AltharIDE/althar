import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the drafting lab (README.md), headless, at 1×, into lab/drafting/shots: each take on C2 while it assembles and
 * as the plan, its card only, and the plan narrow; then the dropdown of a whole seat, open. With the lab running on port
 * 6133; outside an agent's sandbox.
 *
 *   node lab/drafting/shoot.ts [take…]
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const takes = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['2', '3', '4', '5', '6']
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 820, height: 620 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => console.error('page error:', error.message))
const say = (line: string) => process.stdout.write(`${line}\n`)

const card = async (name: string, query: string, width = 820) => {
  await page.setViewportSize({ width, height: 620 })
  await page.goto(`http://localhost:6133/?${query}`)
  await page.waitForTimeout(900)
  await page
    .locator('[data-ready]')
    .first()
    .screenshot({ path: join(out, `${name}.png`) })
  say(name)
}

for (const d of takes) {
  await card(`t${d}-assembling`, `d=${d}&at=20500`)
  await card(`t${d}-plan`, `d=${d}&at=29000`)
  await card(`t${d}-narrow`, `d=${d}&narrow=1&at=29000`, 620)
}

// A whole seat is its dropdown: the lead's, open.
await page.setViewportSize({ width: 820, height: 760 })
await page.goto('http://localhost:6133/?d=3&at=29000')
await page.waitForTimeout(800)
await page.getByRole('button', { name: /Lead for this task/ }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: join(out, 'open-seat.png') })
say('open-seat')
await browser.close()
