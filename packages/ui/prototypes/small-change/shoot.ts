import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { createRequire } from 'node:module'

// The desktop app holds Playwright; the kit doesn't.
const { chromium } = createRequire(join(import.meta.dirname, '../../../../apps/desktop/package.json'))('@playwright/test') as {
  chromium: { launch: () => Promise<any> }
}

/*
 * Shoots the prototype at 1× into shots/, with the page running on 6143:
 * every direction's grid in light and dark, and its card in a thread at
 * ready to merge (light) and with findings (dark). Run it outside an agent's
 * sandbox: node packages/ui/prototypes/small-change/shoot.ts
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 })
const shot = async (name: string, query: string) => {
  await page.goto(`http://localhost:6143/?${query}&shot`)
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true })
}
for (const d of (process.argv[2] ?? 'route').split(',').filter(Boolean)) {
  await shot(`${d}-grid-light`, `d=${d}&theme=light&only=grid`)
  await shot(`${d}-grid-dark`, `d=${d}&theme=dark&only=grid`)
  await page.setViewportSize({ width: 640, height: 900 })
  await shot(`${d}-thread-ready-light`, `d=${d}&theme=light&only=thread&s=5`)
  await shot(`${d}-thread-findings-dark`, `d=${d}&theme=dark&only=thread&s=10`)
  await shot(`${d}-thread-hover-light`, `d=${d}&theme=light&only=thread&s=3&hover`)
  if (d !== 'now') {
    await page.goto(`http://localhost:6143/?d=${d}&theme=light&only=thread&s=5&shot`)
    await page.waitForTimeout(500)
    const t = page.locator('[class*="thread"] button[aria-haspopup]').first()
    if ((await t.count()) > 0) {
      await t.click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(out, `${d}-thread-menu-light.png`) })
    }
  }
  await page.setViewportSize({ width: 1240, height: 900 })
}
// B, the one picked, under each of the project's settings for what follows the merge.
if (process.argv[3] === 'modes')
  for (const r of ['major', 'all', 'off']) {
    await shot(`b-${r}-grid-light`, `d=b&theme=light&only=grid&r=${r}`)
    await shot(`b-${r}-grid-dark`, `d=b&theme=dark&only=grid&r=${r}`)
    await page.setViewportSize({ width: 640, height: 900 })
    await shot(`b-${r}-hover-light`, `d=b&theme=light&only=thread&s=3&hover&r=${r}`)
    await page.setViewportSize({ width: 1240, height: 900 })
  }
// D–F, the review this change has: pointed at, its menu open, and taken off.
if (process.argv[3] === 'review')
  for (const d of ['d', 'e', 'f']) {
    await shot(`${d}-grid-light`, `d=${d}&theme=light&only=grid`)
    await shot(`${d}-grid-dark`, `d=${d}&theme=dark&only=grid`)
    await page.setViewportSize({ width: 640, height: 420 })
    await page.goto(`http://localhost:6143/?d=${d}&theme=light&only=thread&s=5&shot`)
    await page.waitForTimeout(500)
    const line = page.locator('[class*="__line__"]').first()
    await line.hover()
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(out, `${d}-pointed-light.png`) })
    const trigger = line.locator('button[aria-haspopup]').first()
    if ((await trigger.count()) > 0) {
      await trigger.click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(out, `${d}-menu-light.png`) })
      await page.getByRole('menuitemradio', { name: /No review/ }).click()
    } else await line.getByText('Skip the review').click()
    await page.mouse.move(600, 400)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(out, `${d}-dropped-light.png`) })
    await page.setViewportSize({ width: 1240, height: 900 })
  }
await browser.close()
