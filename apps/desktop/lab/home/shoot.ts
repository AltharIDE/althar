import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the home lab (README.md), headless, at 1×, into lab/home/shots (git leaves it alone): each direction's states,
 * light and dark, wide and narrow, its bar hidden. With the lab running (Home lab, on port 6141):
 *
 *   node lab/home/shoot.ts
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const shots: ReadonlyArray<readonly [name: string, query: string, width?: number]> = [
  ['a1-both', 'd=a&talk=1&board=1'],
  ['a2-board-closed', 'd=a&talk=1&board=0'],
  ['a3-talk-closed', 'd=a&talk=0&board=1'],
  ['a4-narrow-board-dark', 'd=a&one=board&narrow=1&theme=dark', 760],
  ['b1-both-swapped-dark', 'd=b&talk=1&board=1&swapped=1&theme=dark'],
  ['b2-talk-closed', 'd=b&talk=0&board=1'],
  ['b3-board-closed-dark', 'd=b&talk=1&board=0&theme=dark'],
  ['c1-board-closed', 'd=c&board=0'],
  ['c2-board-open-dark', 'd=c&board=1&theme=dark'],
  ['c3-narrow-board-open', 'd=c&board=1&narrow=1', 760],
  ['d1-board-home', 'd=d&talk=0'],
  ['d2-drawer-dark', 'd=d&talk=1&theme=dark'],
  ['d3-pinned', 'd=d&talk=1&pinned=1'],
  ['d4-narrow-drawer-dark', 'd=d&talk=1&narrow=1&theme=dark', 760],
  ['e1-conversation', 'd=e&one=talk'],
  ['e2-board-dark', 'd=e&one=board&theme=dark'],
]

const browser = await chromium.launch()
for (const [name, query, width = 1280] of shots) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.error(`${name}: ${error.message}`))
  await page.goto(`http://localhost:6141/?${query}&shot=1`)
  await page.waitForSelector('[role="log"], section[aria-label="Conversation"], h2', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, `${name}.png`) })
  await page.close()
  process.stdout.write(`${name}\n`)
}
await browser.close()
