// Shoots each direction in its states, at 1×, the app's window only, into lab/runs/shots (the lab running on 6183):
// node lab/runs/shoot.mjs, from apps/desktop; with names after it, only those. Chromium can't start in an agent's
// sandbox on a Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })

const wait = (page, ms) => page.waitForTimeout(ms)
const runList = (page) => page.locator('button[aria-haspopup]', { hasText: /^Run/ }).first().click()
const console_ = (page) => page.locator('button[aria-label="Output"]').last().click()
const terminalHere = (page) => page.locator('[data-lab-window] button', { hasText: 'Open a terminal here' }).first().click()
const type = async (page, field, command, ms) => {
  const input = page.locator(`[data-lab-window] ${field}`).last()
  await input.fill(command)
  await input.press('Enter')
  await wait(page, ms)
}
const shell = 'input[aria-label^="Terminal in"]'
const composerShell = 'input[aria-label^="Command in"]'
/** The failed run, a terminal where it ran, and its lockfile brought up to date. */
const fixIt = async (page, field = shell) => {
  await terminalHere(page)
  await wait(page, 300)
  await type(page, field, 'git status', 400)
  await type(page, field, 'bun install', 3200)
}

const W = 1280
const N = 880
const shots = [
  // Today: Run's list, and what a run printed in a console over its card.
  ['0-today-list', 'd=today', W, runList],
  ['0-today-console', 'd=today', W, console_],
  // A · Beside.
  ['a1-failed', 'd=a', W, console_],
  ['a2-terminal', 'd=a', W, async (page) => (await console_(page), await fixIt(page))],
  [
    'a3-again',
    'd=a',
    W,
    async (page) => {
      await console_(page)
      await fixIt(page)
      await page.locator('[data-workbench] aside button[aria-haspopup]').first().click()
      await page.getByRole('menuitem', { name: /iOS/ }).click()
      await page.locator('[data-workbench] button', { hasText: 'Run again' }).click()
      await wait(page, 1200)
    },
  ],
  ['a4-list', 'd=a', W, runList],
  [
    'a5-menu-many',
    'd=a&scene=many',
    W,
    async (page) => (await console_(page), await page.locator('[data-workbench] aside button[aria-haspopup]').first().click()),
  ],
  ['a6-dark', 'd=a&theme=dark', W, async (page) => (await console_(page), await fixIt(page))],
  ['a7-narrow', 'd=a', N, console_],
  ['a8-quiet', 'd=a&scene=quiet', W, runList],
  // B · Along the foot.
  ['b1-rest', 'd=b', W, async () => {}],
  ['b2-raised', 'd=b', W, async (page) => page.getByRole('tab', { name: /iOS/ }).click()],
  ['b3-terminal', 'd=b', W, async (page) => (await page.getByRole('tab', { name: /iOS/ }).click(), await fixIt(page))],
  ['b4-many-dark', 'd=b&scene=many&theme=dark', W, async (page) => page.getByRole('tab', { name: /iOS/ }).click()],
  ['b5-narrow-many', 'd=b&scene=many', N, async () => {}],
  // C · In the thread.
  ['c1-failed', 'd=c', W, async () => {}],
  ['c2-terminal', 'd=c', W, async (page) => fixIt(page, composerShell)],
  ['c3-dark', 'd=c&theme=dark', W, async (page) => fixIt(page, composerShell)],
  ['c4-narrow', 'd=c', N, async (page) => fixIt(page, composerShell)],
  // D · A tab of its own.
  ['d1-tab', 'd=d', W, async () => {}],
  ['d2-failed', 'd=d', W, console_],
  ['d3-split', 'd=d', W, async (page) => (await console_(page), await fixIt(page))],
  ['d4-dark', 'd=d&theme=dark&scene=many', W, async (page) => (await console_(page), await fixIt(page))],
]

const only = process.argv.slice(2)
const browser = await chromium.launch()
for (const [
  name,
  query,
  width,
  act,
] of /** @type {Array<[string, string, number, (page: import('@playwright/test').Page) => Promise<unknown>]>} */ (shots)) {
  if (only.length > 0 && !only.some((one) => name.startsWith(one))) continue
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6183/?${query}`)
  await wait(page, 1000)
  await act(page)
  await wait(page, 500)
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}
await browser.close()
