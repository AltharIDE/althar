// Shoots every direction in every state, at 1×, into lab/errand/shots (the lab running on 6133): node lab/errand/shoot.mjs
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 860, height: 400 }, deviceScaleFactor: 1 })
const shots = [
  ['today', 'waiting'],
  ...['a', 'b', 'c'].flatMap((d) => ['waiting', 'checks', 'partway', 'done', 'paused'].map((s) => [d, s])),
]
for (const [d, s] of shots) {
  await page.goto(`http://localhost:6133/?d=${d}&s=${s}`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, `${d}-${s}.png`) })
}
await browser.close()
