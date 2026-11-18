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
/** The failed run, a terminal where it ran, and its lockfile brought up to date. */
const fixIt = async (page, field = shell) => {
  await terminalHere(page)
  await wait(page, 300)
  await type(page, field, 'git status', 400)
  await type(page, field, 'bun install', 3200)
}

const W = 1280
const N = 880
const tab = (page, name) => page.getByRole('tab', { name }).first().click()
const lineItem = (page, name) =>
  page.locator('[data-lab-window] footer[aria-label="Runs and terminals"] button', { hasText: name }).first().click()
const shots = [
  // Today: Run's list, and what a run printed in a console over its card.
  ['0-today-list', 'd=today', W, runList],
  ['0-today-console', 'd=today', W, console_],
  // B · Along the foot.
  ['b-rest', 'd=b', W, async () => {}],
  ['b-raised', 'd=b', W, async (page) => tab(page, /iOS/)],
  ['b-terminal', 'd=b', W, async (page) => (await tab(page, /iOS/), await fixIt(page))],
  ['b-many-dark', 'd=b&scene=many&theme=dark', W, async (page) => tab(page, /iOS/)],
  ['b-narrow-many', 'd=b&scene=many', N, async () => {}],
  // B1 · A status line, and its drawer.
  ['1-rest', 'd=b1', W, async () => {}],
  ['1-raised', 'd=b1', W, async (page) => lineItem(page, /iOS/)],
  ['1-terminal', 'd=b1', W, async (page) => (await lineItem(page, /iOS/), await fixIt(page))],
  ['1-many-dark', 'd=b1&scene=many&theme=dark', W, async (page) => lineItem(page, /Storybook/)],
  ['1-narrow', 'd=b1', N, async (page) => lineItem(page, /iOS/)],
  ['1-narrow-many', 'd=b1&scene=many', N, async () => {}],
  // B2 · Under the conversation.
  ['2-rest', 'd=b2', W, async () => {}],
  ['2-raised', 'd=b2', W, async (page) => tab(page, /iOS/)],
  ['2-terminal', 'd=b2', W, async (page) => (await tab(page, /iOS/), await fixIt(page))],
  ['2-many-dark', 'd=b2&scene=many&theme=dark', W, async (page) => tab(page, /iOS/)],
  ['2-narrow', 'd=b2', N, async (page) => tab(page, /iOS/)],
  // B3 · Only when called.
  ['3-rest', 'd=b3', W, async () => {}],
  ['3-raised', 'd=b3', W, console_],
  ['3-split', 'd=b3', W, async (page) => (await console_(page), await fixIt(page))],
  [
    '3-whole-dark',
    'd=b3&scene=many&theme=dark',
    W,
    async (page) => {
      await console_(page)
      await fixIt(page)
      await page.locator('[data-lab-window] button[aria-label="The whole screen"]').click()
    },
  ],
  ['3-narrow', 'd=b3', N, async (page) => (await console_(page), await fixIt(page))],
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
