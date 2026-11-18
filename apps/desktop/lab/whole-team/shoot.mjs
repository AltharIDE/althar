// Shoots each exploration's moments, at 1×, the page whole (the app's window over the lab's bar), into
// lab/whole-team/shots, with the lab running on 6181: node lab/whole-team/shoot.mjs [name…]. A moves through its
// pointing for real: Comment, the empty Up next lane in the running app, a note, into the composer. Chromium can't start
// in an agent's sandbox on a Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const LAB = 'http://localhost:6181'
const size = { width: 1360, height: 820 }

/** Every running app drawn in the page has drawn its board. */
const settled = async (page) => {
  await page.waitForLoadState('networkidle')
  // The running apps are drawn once the app's own screen has read what it shows.
  await page.waitForTimeout(1500)
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    await frame.waitForSelector('text=Up next', { timeout: 15_000 }).catch(() => undefined)
  }
  await page.waitForTimeout(700)
}

const shots = [
  ['a1-opens', 'd=a&m=0'],
  [
    'a2-points',
    'd=a&m=1',
    async (page) => {
      await page.getByRole('button', { name: 'Comment' }).click()
      const app = page.frameLocator('iframe[title="althar, running"]')
      await app.getByText('Nothing queued').first().click()
      await page
        .getByRole('textbox', { name: /Comment on/ })
        .fill('These read cold for someone’s first day. Warmer, and say what to do next.')
    },
  ],
  [
    'a2-in-composer',
    'd=a&m=1',
    async (page) => {
      await page.getByRole('button', { name: 'Comment' }).click()
      const app = page.frameLocator('iframe[title="althar, running"]')
      await app.getByText('Nothing queued').first().click()
      await page
        .getByRole('textbox', { name: /Comment on/ })
        .fill('These read cold for someone’s first day. Warmer, and say what to do next.')
      await page.getByRole('button', { name: 'Comment', exact: true }).last().click()
    },
  ],
  ['a3-running', 'd=a&m=2'],
  ['b1-preview', 'd=b&m=0'],
  ['b1-on-main', 'd=b&m=0', async (page) => page.getByRole('radio', { name: 'On main' }).click()],
  ['b2-hand-off', 'd=b&m=1'],
  ['b3-with-ana', 'd=b&m=2'],
  ['c1-board', 'd=c&m=0'],
  ['c2-evidence', 'd=c&m=1'],
  ['c2-evidence-code', 'd=c&m=1', async (page) => page.getByRole('button', { name: 'See the code' }).click()],
  ['c3-approved', 'd=c&m=2'],
  ['c-phone', 'd=c&m=1&phone=1'],
  ['d1-people', 'd=d&m=0'],
  [
    'd1-people-may',
    'd=d&m=0',
    async (page) => page.getByRole('heading', { name: 'What each may change on their own' }).evaluate((one) => one.scrollIntoView()),
  ],
  ['d2-guardrail', 'd=d&m=1'],
  ['e1-board', 'd=e&m=0'],
  ['e2-team', 'd=e&m=1'],
]

const only = process.argv.slice(2)
const browser = await chromium.launch()
for (const [name, query, act] of shots) {
  if (only.length > 0 && !only.some((one) => name.startsWith(one))) continue
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 })
  await page.goto(`${LAB}/?${String(query)}`)
  await settled(page)
  if (act !== undefined) {
    await act(page)
    await settled(page)
  }
  await page.screenshot({ path: join(out, `${String(name)}.png`) })
  process.stdout.write(`${String(name)}\n`)
  await page.close()
}
await browser.close()
