// Shoots each direction in each state, at 1×, the app's window only, into lab/whats-new/shots (the lab running on
// 6183): node lab/whats-new/shoot.mjs, or with names to shoot only those. Chromium can't start in an agent's sandbox
// on a Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()

/** Presses what a state needs pressed after it opens. */
const press = {
  quick: async (page) => page.getByRole('button', { name: 'Althar settings' }).click(),
  line: async (page) => page.getByRole('button', { name: 'What’s new' }).click(),
  every: async (page) => page.getByRole('button', { name: /Every change in/ }).click(),
  homeButton: async (page) => page.getByRole('button', { name: 'What’s new' }).click(),
  // The newest folded, so both releases new since 0.8.0 show.
  fold: async (page) => page.getByRole('button', { name: /^0\.10\.0/ }).click(),
  // Shape it: the person wants two things, the most wanted and another.
  want: async (page) => {
    const wants = page.getByRole('button', { name: /^Want / })
    await wants.nth(0).click()
    await wants.nth(2).click()
  },
}

// [name, query, width, what to press, height]: a tall window shows a look whole.
const WHOLE = 2400
const shots = [
  // The three looks, as the window opens on What's new (A), then whole.
  ['1-light', 'd=a&look=launch#/whats-new', 1280],
  ['1-light-whole', 'd=a&look=launch#/whats-new', 1280, undefined, WHOLE],
  ['1-light-narrow', 'd=a&look=launch&narrow=1#/whats-new', 880],
  ['2-live', 'd=a&look=live#/whats-new', 1280],
  ['2-live-whole', 'd=a&look=live#/whats-new', 1280, undefined, 3400],
  ['2-live-narrow', 'd=a&look=live&narrow=1#/whats-new', 880],
  ['3-log', 'd=a&look=log#/whats-new', 1280],
  ['3-log-whole', 'd=a&look=log#/whats-new', 1280, undefined, 3000],
  ['3-log-narrow', 'd=a&look=log&narrow=1#/whats-new', 880],
  // Coming next, in its three looks (A's tab, on its other view), then whole.
  ['4-horizon', 'd=a&view=coming&coming=horizon#/whats-new', 1280],
  ['4-horizon-whole', 'd=a&view=coming&coming=horizon#/whats-new', 1280, undefined, 2900],
  ['4-horizon-narrow', 'd=a&view=coming&coming=horizon&narrow=1#/whats-new', 880, undefined, 1600],
  ['5-workshop', 'd=a&view=coming&coming=workshop#/whats-new', 1440, undefined, 900],
  ['5-workshop-narrow', 'd=a&view=coming&coming=workshop&narrow=1#/whats-new', 880],
  ['6-shape', 'd=a&view=coming&coming=shape#/whats-new', 1280],
  ['6-shape-whole', 'd=a&view=coming&coming=shape#/whats-new', 1280, 'want', 2000],
  ['6-shape-narrow', 'd=a&view=coming&coming=shape&narrow=1#/whats-new', 880, undefined, 1600],
  // Where it lives, unchanged: B's line, C's home, D's tab and its Coming next.
  ['b-1-line', 'd=b', 1280],
  ['c-1-home', 'd=c', 1280],
  ['c-2-page', 'd=c&look=launch', 1280, 'homeButton'],
  ['d-1-tab', 'd=d', 1280],
  ['d-2-page', 'd=d&look=log#/whats-new', 1280],
  ['d-3-coming', 'd=d&view=coming&coming=workshop#/whats-new', 1280],
  ['c-3-coming', 'd=c&notes=1&view=coming&coming=horizon', 1280],
]
const only = process.argv.slice(2)
for (const [name, query, width, then, height = 760] of shots) {
  if (only.length > 0 && !only.some((one) => name.startsWith(one))) continue
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6183/?${query}`)
  // The light and the mark come up over a second or so.
  await page.waitForTimeout(2200)
  if (then !== undefined) {
    await press[then](page)
    await page.waitForTimeout(700)
  }
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}
await browser.close()
