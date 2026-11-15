// Shoots each direction in each state, at 1×, the app's window only, into lab/conversation-bar/shots (the lab running
// on 6177): node lab/conversation-bar/shoot.mjs; with "again", only C again's (1–4). Chromium can't start in an agent's
// sandbox on a Mac; run it outside.
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
const first = [
  ...['today', 'a', 'b', 'c', 'd', 'e'].flatMap((d) => states.map(([name, query, width]) => [`${d}-${name}`, `d=${d}${query}`, width])),
  ['c-menu', 'd=c&open=merge-queue-reruns&menu=1', 1280],
  ['d-narrow-menu', 'd=d&open=merge-queue-reruns&narrow=1&many=1&menu=1', 880],
]
// C again: each on the coordinator and with an aside open, its search open, and a new aside; the asides self-named.
const again = [
  ['c1-search', 'd=c1&menu=1&named=1', 1280],
  ['c1-search-words', 'd=c1&menu=1&named=1&q=rebase', 1280],
  ['c1-aside-named', 'd=c1&open=merge-queue-reruns&named=1', 1280],
  ['c1-aside-long', 'd=c1&open=merge-queue-reruns', 1280],
  ['c1-new', 'd=c1&new=1&named=1', 1280],
  ['c2-coordinator', 'd=c2&named=1', 1280],
  ['c2-aside', 'd=c2&open=merge-queue-reruns&named=1', 1280],
  ['c3-coordinator', 'd=c3&named=1', 1280],
  ['c3-search', 'd=c3&menu=1&named=1&q=check', 1280],
  ['c3-aside', 'd=c3&open=merge-queue-reruns&named=1', 1280],
  ['c4-panel', 'd=c4&menu=1&named=1&many=1', 1280],
  ['c4-panel-aside', 'd=c4&menu=1&named=1&open=merge-queue-reruns', 1280],
]
const shots = process.argv[2] === 'again' ? again : first
for (const [name, query, width] of shots) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6177/?${query}`)
  await page.waitForTimeout(900)
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  // The conversation's pane alone, under the window's tabs, for a closer look.
  mkdirSync(join(out, 'pane'), { recursive: true })
  await page.screenshot({ path: join(out, 'pane', `${name}.png`), clip: { x: 0, y: 90, width: 580, height: 300 } })
  await page.close()
}
await browser.close()
