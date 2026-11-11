import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

/*
 * Shoots the lab at 1×, into lab/new-project/shots, with it running (README.md):
 * each shot by its address, some after a press, in the order the person reads them.
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6163'
const press =
  (role: 'button' | 'radio', name: string | RegExp, wait = 700) =>
  async (page: Page) => {
    await page.getByRole(role, { name }).first().click()
    await page.waitForTimeout(wait)
  }
const shots: ReadonlyArray<[string, string, ((page: Page) => Promise<void>)?]> = [
  ['01-a-files', 'd=a&s=files'],
  ['02-a-unborn', 'd=a&s=unborn'],
  ['03-a-working', 'd=a&s=working'],
  ['04-b-files', 'd=b&s=files&c=all'],
  ['05-b-code', 'd=b&s=files&c=all', press('button', /^Continue/)],
  ['06-b-github', 'd=b&s=files&c=all&card=host'],
  ['07-b-issues-dark', 'd=b&s=files&c=all&card=issues&theme=dark'],
  ['08-b-team', 'd=b&s=files&c=all&card=team'],
  ['09-b-ready', 'd=b&s=files&c=all&card=ready'],
  ['10-b-making', 'd=b&s=files&c=all&card=ready', press('button', /Create Tidepool/, 1300)],
  ['11-b-made', 'd=b&s=files&c=all&card=ready', press('button', /Create Tidepool/, 4200)],
  ['12-c-files', 'd=c&s=files&c=all'],
  ['13-c-change-dark', 'd=c&s=files&c=all&theme=dark', press('button', /Change/)],
  ['14-c-making', 'd=c&s=local&c=all', press('button', /Create Tidepool/, 1300)],
  ['15-b-none-code', 'd=b&s=empty&c=none&card=code'],
  ['16-b-none-connect', 'd=b&s=empty&c=none&card=code', press('radio', /Connect GitHub or GitLab/)],
  ['17-b-empty', 'd=b&s=empty&c=all'],
  ['18-b-unreadable', 'd=b&s=unreadable&c=all'],
  ['19-b-project-dark', 'd=b&s=project&c=all&theme=dark'],
  ['20-b-settings-put', 'd=b&s=working&c=all', press('button', 'Put tidepool on GitHub…')],
  ['21-b-remote-dark', 'd=b&s=remote&c=all&theme=dark'],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
for (const [name, query, act] of shots) {
  await page.goto(`http://localhost:${port}/?${query}`)
  await page.waitForTimeout(500)
  if (act !== undefined) await act(page)
  await page.screenshot({ path: join(out, `${name}.png`) })
}
await browser.close()
