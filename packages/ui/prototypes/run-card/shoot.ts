import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { createRequire } from 'node:module'

// The desktop app holds Playwright; the kit doesn't.
const { chromium } = createRequire(join(import.meta.dirname, '../../../../apps/desktop/package.json'))('@playwright/test') as {
  chromium: { launch: () => Promise<any> }
}

/*
 * Shoots the prototype at 1× into shots/, with the page running on 6151:
 * every direction's states in light and dark; its card in a thread, running,
 * with the command on hover; in the project's conversation; and D's fold open
 * on a failure. Run it outside an agent's sandbox:
 * node packages/ui/prototypes/run-card/shoot.ts
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 980, height: 600 }, deviceScaleFactor: 1 })
const shot = async (name: string, query: string, width = 980) => {
  await page.setViewportSize({ width, height: 600 })
  await page.goto(`http://localhost:6151/?${query}&shot`)
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true })
}
for (const d of ['now', 'a', 'b', 'c', 'd']) {
  await shot(`${d}-light`, `d=${d}&theme=light&only=grid`)
  await shot(`${d}-dark`, `d=${d}&theme=dark&only=grid`)
  await shot(`${d}-thread-hover`, `d=${d}&theme=light&only=thread&s=2&peek`, 700)
  await shot(`${d}-thread-project-dark`, `d=${d}&theme=dark&only=thread&s=6`, 700)
}
await shot('d-fold-failed', 'd=d&theme=light&only=thread&s=3&fold', 700)
await shot('d-fold-running-dark', 'd=d&theme=dark&only=thread&s=2&fold', 700)
await browser.close()
