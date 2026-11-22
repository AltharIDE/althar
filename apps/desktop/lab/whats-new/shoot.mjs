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
}

const shots = [
  // A: the window opens on What's new's tab.
  ['a-1-opens', 'd=a', 1280],
  ['a-2-quick-settings', 'd=a', 1280, 'quick'],
  // B: the window opens where it was; the bar's end offers it; pressed, the tab and its highlights.
  ['b-1-line', 'd=b', 1280],
  ['b-2-highlights', 'd=b', 1280, 'line'],
  ['b-3-every-change', 'd=b#/whats-new', 1280, 'every'],
  ['b-4-narrow', 'd=b&narrow=1#/whats-new', 880],
  // C: the home at rest says it; pressed, the notes in its place.
  ['c-1-home', 'd=c', 1280],
  ['c-2-notes', 'd=c', 1280, 'homeButton'],
  ['c-3-highlights', 'd=c&read=highlights', 1280, 'homeButton'],
  // D: Althar's tab, with a dot; its page, two releases new; Coming next.
  ['d-1-tab', 'd=d', 1280],
  ['d-2-page-from-0.8.0', 'd=d&from=0.8.0#/whats-new', 1280, 'fold'],
  ['d-3-coming', 'd=d&view=coming#/whats-new', 1280],
  ['d-4-narrow', 'd=d&narrow=1#/whats-new', 880],
]
const only = process.argv.slice(2)
for (const [name, query, width, then] of shots) {
  if (only.length > 0 && !only.some((one) => name.startsWith(one))) continue
  const page = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6183/?${query}`)
  await page.waitForTimeout(1200)
  if (then !== undefined) {
    await press[then](page)
    await page.waitForTimeout(700)
  }
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}
await browser.close()
