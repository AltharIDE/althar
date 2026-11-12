import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the drafting lab (README.md), headless, at 1×, into lab/drafting/shots: each direction frozen at a few moments
 * of its draft, and the three-at-once and narrow cases. With the lab running on port 6133; outside an agent's sandbox.
 *
 *   node lab/drafting/shoot.ts
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 820, height: 470 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => console.error('page error:', error.message))

const shoot = async (name: string, query: string, height = 560, width = 820) => {
  await page.setViewportSize({ width, height })
  await page.goto(`http://localhost:6133/?${query}`)
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, `${name}.png`) })
  process.stdout.write(`${name}\n`)
}

const MOMENTS = [
  ['1-start', 500],
  ['2-brief', 9000],
  ['3-lead', 20000],
  ['4-almost', 26500],
] as const
for (const d of ['a', 'b', 'c', 'd']) for (const [moment, at] of MOMENTS) await shoot(`${d}-${moment}`, `d=${d}&at=${at}`)
await shoot('e-ready', 'd=a&at=28000')
await shoot('f-three-c', 'd=c&three=1&at=42000', 820)
await shoot('g-narrow-c', 'd=c&narrow=1&at=20000', 520, 700)
await browser.close()
