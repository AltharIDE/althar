// Shoots each direction, at 1×, the app's window only, into lab/issue-part/shots (the lab running on 6179):
// node lab/issue-part/shoot.mjs. Chromium can't start in an agent's sandbox on a Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()

/** What to press once the task shows: B's tag, C's verb, D's Parts and then the issue's part in it. */
const open = {
  tag: async (page) => page.locator('[class*="__tag__"]').first().click(),
  verb: async (page) => page.locator('[class*="__verb__"]').first().click(),
  part: async (page) => {
    await page.locator('button[aria-label^="Parts"]').click()
    await page.locator('[role="dialog"] li:nth-of-type(2) > button').click()
  },
}

const shots = [
  ['1-today', 'd=today&ending=coming'],
  ['2-a', 'd=a&ending=coming'],
  ['3-b', 'd=b&ending=coming'],
  ['3-b-menu', 'd=b&ending=coming', 'tag'],
  ['4-c', 'd=c&ending=open'],
  ['4-c-menu', 'd=c&ending=open', 'verb'],
  ['5-d', 'd=d&ending=open'],
  ['5-d-part', 'd=d&ending=open', 'part'],
  ['6-a-two', 'd=a&ending=open&two=1&part=%23842'],
  ['6-b-two', 'd=b&ending=open&two=1&part=%23842'],
  ['6-c-two', 'd=c&ending=open&two=1&part=%23842'],
  ['7-no-pr', 'd=a&ending=none'],
]
for (const [name, query, press] of shots) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6179/?${query}`)
  await page.waitForTimeout(900)
  // The thread opens at its latest; with two issues the first is above it.
  await page.locator('[class*="module__issues"]').evaluate((issues) => issues.scrollIntoView({ block: 'start' }))
  if (press !== undefined) {
    await open[press](page)
    await page.waitForTimeout(500)
  }
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  // The head of the thread alone, the issue and what it says of the merge, for a closer look; D's Parts, by the header.
  mkdirSync(join(out, 'close'), { recursive: true })
  const clip = press === 'part' ? { x: 480, y: 44, width: 800, height: 300 } : { x: 300, y: 90, width: 700, height: 340 }
  await page.screenshot({ path: join(out, 'close', `${name}.png`), clip })
  await page.close()
}
await browser.close()
