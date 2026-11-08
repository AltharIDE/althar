// Scrappy: what a press leaves, at 1×, into test-results/calm-parts: the presses the review named, then a picture of the case after.
// node after.mjs [id…]   (outside the sandbox: Chromium can't start in it)
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const out = resolve(repo, 'test-results/calm-parts')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const only = process.argv.slice(2)

const partsButton = (page) => page.locator('button[aria-label^="Parts,"]').first()

const SHOTS = [
  {
    id: '30-B-stack-held-shipped',
    d: 'B',
    s: 'stack-held',
    run: async (page) => {
      await page.getByRole('button', { name: /^#716/ }).first().click()
      await page.waitForTimeout(300)
      await page.locator('[role=dialog]').getByRole('button', { name: 'Ship', exact: true }).first().click()
      await page.waitForTimeout(5600)
    },
    around: ['went up on top of', 300, 120],
  },
  {
    id: '31-B-retarget-shipped',
    d: 'B',
    s: 'retarget',
    run: async (page) => {
      await page
        .getByRole('button', { name: /^althar\/board-still-2/ })
        .first()
        .click()
      await page.waitForTimeout(300)
      await page.locator('[role=dialog]').getByRole('button', { name: 'Ship', exact: true }).first().click()
      await page.waitForTimeout(5600)
    },
    around: ['is up as #719', 150, 230],
  },
  {
    id: '32-A-start-one-parts',
    d: 'A',
    s: 'one',
    run: async (page) => {
      await partsButton(page).click()
      await page.waitForTimeout(250)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByRole('button', { name: /^A change/ }).click()
      await page.getByRole('button', { name: 'Start one', exact: true }).click()
      await page.waitForTimeout(500)
    },
  },
  {
    id: '33-A-trusted-access',
    d: 'A',
    s: 'run-it',
    run: async (page) => {
      await page.getByRole('button', { name: 'Trust fully', exact: true }).first().click()
      await page.waitForTimeout(2700)
      await partsButton(page).click()
      await page.waitForTimeout(250)
      await page
        .locator('[role=dialog]')
        .getByRole('button', { name: /Trusted/ })
        .first()
        .click()
      await page.waitForTimeout(250)
    },
  },
  { id: '34-A-stuck-picker', d: 'A', s: 'stuck', run: async () => undefined, around: ['stopped answering', 90, 290] },
  { id: '35-A-usage-picker', d: 'A', s: 'usage', run: async () => undefined, around: ['Out of usage', 40, 330] },
]

for (const shot of SHOTS.filter((one) => only.length === 0 || only.some((id) => one.id.startsWith(id)))) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:5374/?d=${shot.d}&s=${shot.s}&bare#/threads/th1`)
  await page.waitForTimeout(1400)
  await shot.run(page)
  const path = resolve(out, `${shot.id}.png`)
  if (shot.around !== undefined) {
    const [text, before, after] = shot.around
    // Escape closes an open popover; with none open it would leave the task.
    if ((await page.locator('[role=dialog]').count()) > 0) await page.keyboard.press('Escape')
    await page.mouse.move(0, 0)
    const found = page.locator(`text=${text}`).last()
    await found.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined)
    await page.waitForTimeout(300)
    const box = await found.boundingBox({ timeout: 5000 }).catch(() => null)
    const y = Math.max(0, Math.round((box?.y ?? 400) - before))
    await page.screenshot({ path, clip: { x: 280, y, width: 880, height: Math.min(900 - y, before + after) } })
  } else {
    // The parts' popover, with the bar it hangs from.
    await page.mouse.move(0, 0)
    const box = await page.locator('[role=dialog]').last().boundingBox()
    const x = Math.max(0, Math.round((box?.x ?? 900) - 16))
    await page.screenshot({
      path,
      clip: {
        x,
        y: 44,
        width: Math.min(1440 - x, Math.round((box?.width ?? 380) + 180)),
        height: Math.round((box?.y ?? 90) + (box?.height ?? 300) - 44 + 16),
      },
    })
  }
  process.stdout.write(`${shot.id}\n`)
  await page.close()
}
await browser.close()
