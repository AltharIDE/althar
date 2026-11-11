import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the lab at 1×, into lab/new-project/shots, with it running (README.md):
 * each shot by direction, folder state and theme, in the order the person reads them.
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6163'
const shots: ReadonlyArray<[string, string, string, string]> = [
  ['01-a-empty', 'a', 'empty', 'light'],
  ['02-a-unborn', 'a', 'unborn', 'light'],
  ['03-a-working', 'a', 'working', 'light'],
  ['04-b-empty', 'b', 'empty', 'light'],
  ['05-b-files', 'b', 'files', 'dark'],
  ['06-b-unborn', 'b', 'unborn', 'light'],
  ['07-b-local', 'b', 'local', 'light'],
  ['08-b-unreadable', 'b', 'unreadable', 'light'],
  ['09-b-project', 'b', 'project', 'dark'],
  ['10-b-working', 'b', 'working', 'light'],
  ['11-b-remote', 'b', 'remote', 'dark'],
  ['12-c-files', 'c', 'files', 'light'],
  ['13-c-local', 'c', 'local', 'dark'],
  ['14-d-empty', 'd', 'empty', 'light'],
  ['15-d-working', 'd', 'working', 'dark'],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
for (const [name, d, s, theme] of shots) {
  await page.goto(`http://localhost:${port}/?d=${d}&s=${s}&theme=${theme}`)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${name}.png`) })
}
await browser.close()
