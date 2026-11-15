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
const fill =
  (label: string | RegExp, text: string, wait = 200): Act =>
  async (page) => {
    await page.getByLabel(label).first().fill(text)
    await page.waitForTimeout(wait)
  }
const connectBitbucket = all(press('Connect', 400), press('Bitbucket', 500, 'menuitem'))
const shots: ReadonlyArray<[string, string, Act?]> = [
  // The New project tab
  ['01-tab-clone', 'd=a&s=none'],
  ['02-tab-connect-menu', 'd=a&s=none', press('Connect', 500)],
  ['03-tab-bitbucket-token', 'd=a&s=none', connectBitbucket],
  ['04-tab-bitbucket-bad-token', 'd=a&s=none', all(connectBitbucket, fill('API token', 'abc123', 300))],
  ['05-tab-bitbucket-checking', 'd=a&s=none', all(connectBitbucket, fill('API token', 'ATATT3xFfGF0', 100), press(/^Connect$/, 700))],
  ['06-tab-bitbucket-listed', 'd=a&s=none', all(connectBitbucket, fill('API token', 'ATATT3xFfGF0', 100), press(/^Connect$/, 2400))],
  [
    '07-tab-bitbucket-chosen-dark',
    'd=a&s=none&theme=dark',
    all(connectBitbucket, fill('API token', 'ATATT3xFfGF0', 100), press(/^Connect$/, 2400), press(/tidepool-api/, 500)),
  ],
  ['08-tab-files-bitbucket-home', 'd=a&s=files&c=github', press('Connect', 500)],
  ['09-tab-nothing-connected', 'd=a&s=none&c=none'],
  // The first run
  ['10-first-nothing-connected', 'd=b&s=none&c=none'],
  ['11-first-github-browser', 'd=b&s=none&c=none', press('Connect', 600)],
  ['12-first-github-listed', 'd=b&s=none&c=none', all(press('Connect', 600), press(/^Sign in on GitHub/, 3400))],
  [
    '13-first-chosen-dark',
    'd=b&s=none&c=none&theme=dark',
    all(press('Connect', 600), press(/^Sign in on GitHub/, 3400), press(/balazs\/tidepool/, 500)),
  ],
  [
    '14-first-cloning',
    'd=b&s=none&c=none',
    all(press('Connect', 600), press(/^Sign in on GitHub/, 3400), press(/balazs\/tidepool/, 400), press('Make the project', 800)),
  ],
  [
    '15-first-issues-after-clone',
    'd=b&s=none&c=none',
    all(press('Connect', 600), press(/^Sign in on GitHub/, 3400), press(/balazs\/tidepool/, 400), press('Make the project', 2600)),
  ],
  ['16-first-folder', 'd=b&s=files&c=none'],
  ['17-first-folder-code-step', 'd=b&s=files&c=none', press('Make the project', 1800)],
  [
    '18-first-folder-bitbucket',
    'd=b&s=files&c=none',
    all(press('Make the project', 1800), async (page) => {
      await page.getByRole('button', { name: 'Connect', exact: true }).nth(2).click()
      await page.waitForTimeout(500)
    }),
  ],
  ['19-first-opened', 'd=b&s=files&c=none', all(press('Make the project', 1800), press('Continue', 500), press(/^Open /, 800))],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
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
