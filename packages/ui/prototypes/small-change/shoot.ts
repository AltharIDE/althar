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
for (const d of (process.argv[2] ?? 'now,a,b,c').split(',').filter(Boolean)) {
  await shot(`${d}-grid-light`, `d=${d}&theme=light&only=grid`)
  await shot(`${d}-grid-dark`, `d=${d}&theme=dark&only=grid`)
  await page.setViewportSize({ width: 640, height: 900 })
  await shot(`${d}-thread-ready-light`, `d=${d}&theme=light&only=thread&s=5`)
  await shot(`${d}-thread-findings-dark`, `d=${d}&theme=dark&only=thread&s=10`)
  await shot(`${d}-thread-hover-light`, `d=${d}&theme=light&only=thread&s=3&hover`)
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
await browser.close()
