import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

/*
 * Shoots the lab at 1×, into lab/new-project/shots, with it running (README.md):
 * each shot by its address, some after a press or a sentence, in the order the person reads them.
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6163'
const press =
  (name: string | RegExp, wait = 700) =>
  async (page: Page) => {
    await page.getByRole('button', { name }).first().click()
    await page.waitForTimeout(wait)
  }
const say =
  (text: string, wait = 2200) =>
  async (page: Page) => {
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(wait)
  }
const choose = press('Choose a folder…', 2600)
const shots: ReadonlyArray<[string, string, ((page: Page) => Promise<void>)?]> = [
  ['01-a-waiting', 'd=a&s=files'],
  ['02-a-reading', 'd=a&s=files', press('Choose a folder…', 350)],
  ['03-a-files', 'd=a&s=files', choose],
  ['04-a-unborn-dark', 'd=a&s=unborn&theme=dark', choose],
  ['05-a-empty', 'd=a&s=empty', choose],
  [
    '06-a-empty-said',
    'd=a&s=empty',
    async (page) => {
      await choose(page)
      await say('A tide table for the Pacific coast, in the browser.')(page)
    },
  ],
  ['07-a-unreadable', 'd=a&s=unreadable', press('Choose a folder…', 500)],
  ['08-a-project-dark', 'd=a&s=project&theme=dark', press('Choose a folder…', 500)],
  ['09-b-files', 'd=b&s=files'],
  ['10-b-empty-dark', 'd=b&s=empty&theme=dark'],
  ['11-b-started', 'd=b&s=files', press(/^Start Tidepool/, 2600)],
  ['12-b-unreadable', 'd=b&s=unreadable'],
  ['13-later-working', 'd=a&s=working'],
  ['14-later-on-github', 'd=a&s=working', press(/^Send/, 2200)],
  ['15-later-on-github-dark', 'd=a&s=remote&theme=dark'],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
for (const [name, query, act] of shots) {
  await page.goto(`http://localhost:${port}/?${query}`)
  await page.waitForTimeout(600)
  if (act !== undefined) await act(page)
  await page.screenshot({ path: join(out, `${name}.png`) })
}
await browser.close()
