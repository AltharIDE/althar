import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { createRequire } from 'node:module'

// The desktop app holds Playwright; the kit doesn't.
const { chromium } = createRequire(join(import.meta.dirname, '../../../../apps/desktop/package.json'))('@playwright/test') as {
  chromium: { launch: () => Promise<any> }
}

/*
 * Shoots the prototype at 1× into shots/, with the page running on 6151.
 * Round 1 (`1`): every direction's states in light and dark, its card in a
 * thread with the command on hover, in the project's conversation, and D's
 * fold open. Round 2 (`2`, the default): the fold's second round, D1–D3, each
 * in a thread with what it prints open where it opens, light and dark.
 * Run it outside an agent's sandbox: node packages/ui/prototypes/run-card/shoot.ts [1|2]
 */

const round = process.argv[2] ?? '2'
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 980, height: 600 }, deviceScaleFactor: 1 })
const shot = async (name: string, query: string, width = 980, height = 600, full = true, wait = 700) => {
  await page.setViewportSize({ width, height })
  await page.goto(`http://localhost:6151/?${query}&shot`)
  await page.waitForTimeout(wait)
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: full })
}
if (round === '1') {
  for (const d of ['now', 'a', 'b', 'c', 'd']) {
    await shot(`${d}-light`, `d=${d}&theme=light&only=grid`)
    await shot(`${d}-dark`, `d=${d}&theme=dark&only=grid`)
    await shot(`${d}-thread-hover`, `d=${d}&theme=light&only=thread&s=2&peek`, 700)
    await shot(`${d}-thread-project-dark`, `d=${d}&theme=dark&only=thread&s=6`, 700)
  }
  await shot('d-fold-failed', 'd=d&theme=light&only=thread&s=3&fold', 700)
  await shot('d-fold-running-dark', 'd=d&theme=dark&only=thread&s=2&fold', 700)
} else {
  // D1: the console beside the thread, the fold open on the command
  await shot('d1-beside-light', 'd=d1&theme=light&only=thread&s=2&beside=console&fold', 1120, 600, false)
  await shot('d1-beside-failed-dark', 'd=d1&theme=dark&only=thread&s=3&beside=console', 1120, 520, false)
  await shot('d1-states-light', 'd=d1&theme=light&only=grid')
  // D2: the page with its console under it; the line it folds to; the command as facts
  await shot('d2-page-console-light', 'd=d2&theme=light&only=thread&s=2&beside=page&drawer&fold', 1120, 640, false, 2500)
  await shot('d2-page-line-dark', 'd=d2&theme=dark&only=thread&s=2&beside=page', 1120, 600, false, 2500)
  await shot('d2-facts-light', 'd=d2&theme=light&only=thread&s=7&fold', 700, 480, false)
  // D3: the console from the card, the command pinned over it
  await shot('d3-pop-light', 'd=d3&theme=light&only=thread&s=2&pop', 700, 760, false)
  await shot('d3-pop-failed-dark', 'd=d3&theme=dark&only=thread&s=3&pop', 700, 640, false)
  await shot('d3-states-dark', 'd=d3&theme=dark&only=grid')
}
await browser.close()
