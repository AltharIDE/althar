// Shoots each direction in each state, at 1×, the app's window only, into lab/conversation-bar/shots (the lab running
// on 6177): node lab/conversation-bar/shoot.mjs. Chromium can't start in an agent's sandbox on a Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const states = [
  ['coordinator', '', 1280],
  ['aside', '&open=merge-queue-reruns', 1280],
  ['new', '&new=1', 1280],
  ['narrow-many', '&open=merge-queue-reruns&narrow=1&many=1', 880],
]
const shots = [
  ...['today', 'a', 'b', 'c', 'd', 'e'].flatMap((d) => states.map(([name, query, width]) => [`${d}-${name}`, `d=${d}${query}`, width])),
  ['c-menu', 'd=c&open=merge-queue-reruns&menu=1', 1280],
  ['d-narrow-menu', 'd=d&open=merge-queue-reruns&narrow=1&many=1&menu=1', 880],
]
for (const [name, query, width] of shots) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6177/?${query}`)
  await page.waitForTimeout(900)
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}
await browser.close()
