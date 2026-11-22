// Shoots the flow in each state, at 1×, the app's window only, into lab/whats-new/shots (the lab running on 6183):
// node lab/whats-new/shoot.mjs, or with names to shoot only those. Chromium can't start in an agent's sandbox on a
// Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()

/** Presses what a state needs pressed after it opens. */
const press = {
  // Later: the update looked at, the window back on a project, the quick settings open on the version line.
  later: async (page) => {
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: 'Althar settings' }).click()
  },
  // The releases before, folded open: what's new to someone who came from 0.8.0.
  releases: async (page) => {
    await page.getByRole('heading', { name: /Every change/ }).scrollIntoViewIfNeeded()
  },
}

// [name, query, width, what to press, height]: a tall window shows a view whole.
const shots = [
  ['1-just-updated', '', 1280],
  ['2-whats-new', '#/whats-new', 1280],
  ['2-whats-new-whole', '#/whats-new', 1280, undefined, 3400],
  ['3-coming-next', 'view=coming#/whats-new', 1280],
  ['3-coming-next-whole', 'view=coming#/whats-new', 1280, undefined, 2000],
  ['4-version-line', '#/whats-new', 1280, 'later'],
  ['5-from-080', 'from=0.8.0#/whats-new', 1280],
  ['5-from-080-releases', 'from=0.8.0#/whats-new', 1280, 'releases'],
  ['6-narrow', 'narrow=1#/whats-new', 880],
  ['6-narrow-whole', 'narrow=1#/whats-new', 880, undefined, 3800],
  ['6-narrow-coming-whole', 'narrow=1&view=coming#/whats-new', 880, undefined, 2800],
]
const only = process.argv.slice(2)
for (const [name, query, width, then, height = 760] of shots) {
  if (only.length > 0 && !only.some((one) => name.startsWith(one))) continue
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6183/${query.startsWith('#') ? query : `?${query}`}`.replace(/\?$/, ''))
  // The light and the mark come up over a second or so.
  await page.waitForTimeout(2200)
  if (then !== undefined) {
    await press[then](page)
    await page.waitForTimeout(900)
  }
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}
await browser.close()
