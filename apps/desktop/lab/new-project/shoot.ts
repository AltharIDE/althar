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
  (name: string | RegExp, wait = 500, role: 'button' | 'menuitem' = 'button'): Act =>
  async (page) => {
    await page.getByRole(role, { name }).first().click()
    await page.waitForTimeout(wait)
  }
const all =
  (...acts: Act[]): Act =>
  async (page) => {
    for (const act of acts) await act(page)
  }
const gitUp = all(press('Set up', 400), press('Set up git', 2200))
const shots: ReadonlyArray<[string, string, Act?]> = [
  ['01-new-project', 'd=a&s=files'],
  ['02-a-card', 'p=1&d=a&s=files'],
  ['03-a-git', 'p=1&d=a&s=files', press('Set up', 600)],
  ['04-a-github-dark', 'p=1&d=a&s=files&theme=dark', all(gitUp, press('Put it on', 300), press('GitHub', 500, 'menuitem'))],
  [
    '05-a-done',
    'p=1&d=a&s=files',
    all(gitUp, press('Put it on', 300), press('GitHub', 500, 'menuitem'), press('Create and push main', 2200)),
  ],
  ['06-b-git', 'p=1&d=b&s=files'],
  ['07-b-code', 'p=1&d=b&s=files', press('Set up git', 2200)],
  ['08-b-host-dark', 'p=1&d=b&s=files&theme=dark', all(press('Set up git', 2200), press(/A new repository on GitHub/))],
  [
    '09-b-issues',
    'p=1&d=b&s=files',
    all(press('Set up git', 2200), press(/A new repository on GitHub/), press('Create and push main', 2200)),
  ],
  [
    '10-b-done',
    'p=1&d=b&s=files',
    all(
      press('Set up git', 2200),
      press(/A new repository on GitHub/),
      press('Create and push main', 2200),
      press(/^Linear/),
      press(/A new team, Tidepool/, 700),
    ),
  ],
  ['11-c-ask', 'p=1&d=c&s=files'],
  ['12-c-answered', 'p=1&d=c&s=files', all(press('Set it up', 1300), press(/^GitHub$/, 1300))],
  ['13-c-empty-dark', 'p=1&d=c&s=empty&theme=dark'],
  ['14-d-git', 'p=1&d=d&s=files'],
  ['15-d-later', 'd=d&s=later'],
  ['16-d-later-put-dark', 'd=d&s=later&theme=dark', all(press('Put it on a host first', 300), press('GitHub', 500, 'menuitem'))],
  ['17-new-unreadable', 'd=a&s=unreadable'],
  ['18-new-project-dark', 'd=a&s=project&theme=dark'],
  ['19-a-nothing-connected', 'p=1&d=a&s=local&c=none'],
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
