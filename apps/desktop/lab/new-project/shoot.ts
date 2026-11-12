import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

/*
 * Shoots the lab at 1×, into lab/new-project/shots, with it running (README.md):
 * each shot by its address, some after presses, in the order the person reads them.
 */

const out = join(import.meta.dirname, 'shots')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6163'
type Act = (page: Page) => Promise<void>
const press =
  (name: string | RegExp, wait = 500, role: 'button' | 'menuitem' | 'radio' = 'button'): Act =>
  async (page) => {
    await page.getByRole(role, { name }).first().click()
    await page.waitForTimeout(wait)
  }
const wait =
  (ms: number): Act =>
  async (page) => {
    await page.waitForTimeout(ms)
  }
const all =
  (...acts: Act[]): Act =>
  async (page) => {
    for (const act of acts) await act(page)
  }
const create = press(/^Create Tidepool/, 300)
const shots: ReadonlyArray<[string, string, Act?]> = [
  ['01-a-repositories', 'd=a&s=none'],
  ['02-a-cloned-chosen', 'd=a&s=none', press(/balazs\/tidepool/, 500)],
  ['03-a-creating', 'd=a&s=none', all(press(/balazs\/tidepool/, 500), create, wait(900))],
  ['04-a-files-dark', 'd=a&s=files&theme=dark'],
  ['05-a-files-creating', 'd=a&s=files', all(create, wait(1500))],
  ['06-a-ready', 'd=a&s=files', all(create, wait(5200))],
  ['07-a-nothing-connected', 'd=a&s=none&c=none'],
  ['08-a-sso', 'd=a&s=none', all(press(/charrette\/infra/, 400), create, wait(1400))],
  ['09-a-unreadable', 'd=a&s=unreadable', all(create, wait(300))],
  ['10-b-doors', 'd=b&s=none'],
  ['11-b-cloned-chosen-dark', 'd=b&s=none&theme=dark', press(/balazs\/tidepool/, 500)],
  ['12-b-folder', 'd=b&s=unborn'],
  ['13-b-start-empty', 'd=b&s=none', press(/^Start empty/, 500, 'radio')],
  ['14-c-sheet', 'd=c&s=none'],
  ['15-c-picker', 'd=c&s=none', press(/balazs\/tidepool/, 500)],
  ['16-c-folder-dark', 'd=c&s=local&theme=dark'],
  ['17-c-creating', 'd=c&s=none', all(create, wait(1000))],
  ['18-c-ready', 'd=c&s=none', all(create, wait(3800))],
  ['19-project-dark', 'd=a&s=project&theme=dark'],
  ['20-later-put', 'd=a&s=later', all(press('Put it on a host first', 300), press('GitHub', 500, 'menuitem'))],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
for (const [name, query, act] of shots) {
  await page.goto(`http://localhost:${port}/?${query}`)
  await page.waitForTimeout(600)
  try {
    if (act !== undefined) await act(page)
  } catch (error) {
    console.error(name, String(error).split('\n')[0])
  }
  await page.screenshot({ path: join(out, `${name}.png`) })
}
await browser.close()
