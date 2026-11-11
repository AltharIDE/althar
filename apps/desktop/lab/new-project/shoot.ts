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
const shots: ReadonlyArray<[string, string]> = [
  ['01-a-empty', 'd=a&s=empty'],
  ['02-a-unborn', 'd=a&s=unborn'],
  ['03-a-working', 'd=a&s=working'],
  ['04-b-empty-step1', 'd=b&s=empty&step=1'],
  ['05-b-files-step1', 'd=b&s=files&step=1&theme=dark'],
  ['06-b-unborn-step1', 'd=b&s=unborn&step=1'],
  ['07-b-step2-here', 'd=b&s=local&step=2&c=all'],
  ['08-b-step2-github', 'd=b&s=local&step=2&c=all&code=github'],
  ['09-b-step2-gitlab-dark', 'd=b&s=files&step=2&c=all&code=gitlab&theme=dark'],
  ['10-b-step2-github-only', 'd=b&s=empty&step=2&c=github&code=github'],
  ['11-b-step2-nothing', 'd=b&s=empty&step=2&c=none'],
  ['12-c-step2-github', 'd=c&s=local&step=2&c=all&code=github'],
  ['13-c-step2-here-dark', 'd=c&s=local&step=2&c=all&theme=dark'],
  ['14-b-unreadable', 'd=b&s=unreadable&step=1'],
  ['15-b-project-dark', 'd=b&s=project&step=1&theme=dark'],
  ['16-b-working', 'd=b&s=working&c=all'],
  ['17-b-remote-dark', 'd=b&s=remote&c=all&theme=dark'],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
for (const [name, query] of shots) {
  await page.goto(`http://localhost:${port}/?${query}`)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${name}.png`) })
}
await browser.close()
