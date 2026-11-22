// Shoots each direction's moments, at 1×, the page whole (the app's window over the lab's bar), into
// lab/artifact-boards/shots, with the lab running on 6196: node lab/artifact-boards/shoot.mjs [name…]. Some shots act
// first (a change sent and landed, a take kept). Chromium can't start in an agent's sandbox on a Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(join(out, 'crops'), { recursive: true })
const LAB = 'http://localhost:6196'
const size = { width: 1440, height: 860 }

/** Every copy of Kiln drawn in the page has drawn its screen. */
const settled = async (page) => {
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined)
  await page.waitForTimeout(1200)
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    await frame.waitForSelector('#root > div', { timeout: 15_000 }).catch(() => undefined)
  }
  await page.waitForTimeout(900)
}

const send = async (page, words) => {
  await page.getByRole('textbox', { name: 'What you think' }).fill(words)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

const shots = [
  ['a1-every-board', 'd=a&m=0'],
  [
    'a-reach',
    'd=a&m=0',
    async (page) => {
      await page.getByRole('button', { name: 'Draft', exact: true }).click()
      await page.waitForTimeout(300)
    },
  ],
  [
    'a-wide',
    'd=a&m=0',
    async (page) => {
      await page.getByRole('button', { name: 'The canvas on its own' }).click()
      await page.waitForTimeout(900)
    },
  ],
  ['a2-point', 'd=a&m=1'],
  [
    'a2-landed',
    'd=a&m=1',
    async (page) => {
      await send(page, 'They still look like a form. Make them feel like presents.')
      await page.waitForTimeout(3200)
    },
  ],
  [
    'a2-takes',
    'd=a&m=1',
    async (page) => {
      await page.getByRole('button', { name: 'Show me a few' }).click()
      await page.waitForTimeout(3200)
    },
  ],
  [
    'a2-kept',
    'd=a&m=1',
    async (page) => {
      await page.getByRole('button', { name: 'Show me a few' }).click()
      await page.waitForTimeout(3200)
      await page.getByRole('button', { name: 'Keep' }).nth(1).click()
      await page.getByRole('radio', { name: 'One board at a time' }).click()
    },
  ],
  ['a3-switch', 'd=a&m=2'],
  ['a4-share', 'd=a&m=3'],
  ['a5-keep', 'd=a&m=4'],
  [
    'a5-saved',
    'd=a&m=4',
    async (page) => {
      await page.getByRole('button', { name: 'Save to kiln' }).click()
      await page.waitForTimeout(2000)
      await page
        .getByRole('button', { name: /^Gift a class/ })
        .first()
        .click()
      await page.waitForTimeout(600)
    },
  ],
  ['a-one-board', 'd=a&m=0', async (page) => page.getByRole('radio', { name: 'One board at a time' }).click()],
  [
    'a-sizes',
    'd=a&m=0',
    async (page) => {
      await page.getByRole('button', { name: 'Directions', exact: true }).click()
      await page.getByRole('menuitemradio', { name: /every size/ }).click()
    },
  ],
  ['b1-gallery', 'd=b&m=0'],
  ['b1-list', 'd=b&m=0', async (page) => page.getByRole('radio', { name: 'List' }).click()],
  [
    'b1-filter',
    'd=b&m=0',
    async (page) => {
      await page.getByRole('button', { name: /^Filter/ }).click()
      await page.getByRole('menuitemradio', { name: /In git/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /Designs/ }).click()
    },
  ],
  [
    'b1-grouped',
    'd=b&m=0',
    async (page) => {
      await page.getByRole('button', { name: /^Newest/ }).click()
      await page
        .getByRole('menuitemcheckbox', { name: /Group by task/ })
        .or(page.getByRole('switch', { name: /Group by task/ }))
        .first()
        .click()
      await page.keyboard.press('Escape')
    },
  ],
  ['b-found', 'd=b&m=0', async (page) => page.getByRole('button', { name: /A class, by hand/ }).click()],
  ['b2-room', 'd=b&m=1'],
  ['b3-share', 'd=b&m=2'],
  ['c1-every-page', 'd=c&m=0'],
  ['c2-room', 'd=c&m=1'],
  ['d1-pins', 'd=d&m=0'],
  ['d2-pin', 'd=d&m=1'],
  [
    'd-new-pin',
    'd=d&m=0',
    async (page) => {
      // Point at the heading on the board, as a person would: a press where it is drawn.
      const box = await page.frameLocator('iframe[title="A present first"]').locator('[data-part="title"]').boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await send(page, 'Too busy next to the card. Quieter.')
      await page.waitForTimeout(3200)
    },
  ],
  ['d3-shared', 'd=d&m=2'],
  [
    'd3-made-with',
    'd=d&m=2',
    async (page) => {
      await page.getByRole('link', { name: /Made with Althar/ }).hover()
      await page.waitForTimeout(500)
    },
  ],
  ['note-a', 'd=a&m=0&note=1'],
  ['e1-path', 'd=e&m=0'],
  ['e2-tree', 'd=e&m=1'],
  [
    'e2-tree-deep',
    'd=e&m=1',
    async (page) => {
      await page
        .getByRole('treeitem', { name: 'gift/' })
        .first()
        .click({ timeout: 4000 })
        .catch(async () => {
          await page.getByRole('button', { name: 'Open apps' }).click()
          await page.getByRole('button', { name: 'Open web' }).click()
          await page.getByRole('button', { name: 'Open src' }).click()
          await page.getByRole('button', { name: 'Open features' }).click()
          await page.getByRole('treeitem', { name: 'gift/' }).click()
        })
      await page.waitForTimeout(400)
    },
  ],
  ['e3-columns', 'd=e&m=2'],
  [
    'e3-columns-deep',
    'd=e&m=2',
    async (page) => {
      await page.getByRole('option', { name: 'apps' }).click()
      await page.getByRole('option', { name: 'web' }).click()
      await page.getByRole('option', { name: 'src' }).click()
      await page.waitForTimeout(500)
    },
  ],
  ['e4-suggested', 'd=e&m=3'],
  [
    'e4-find',
    'd=e&m=3',
    async (page) => {
      await page.getByRole('radio', { name: /Somewhere else/ }).click()
      await page.keyboard.type('flo')
      await page.waitForTimeout(300)
    },
  ],
  [
    'e-kept',
    'd=e&m=1',
    async (page) => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      await page
        .getByRole('button', { name: /^Gift a class/ })
        .first()
        .click()
      await page
        .getByRole('button', { name: /^A calmer checkout/ })
        .first()
        .click()
      await page.waitForTimeout(600)
      await page
        .getByRole('button', { name: /calmer-checkout\// })
        .first()
        .click()
      await page.waitForTimeout(400)
    },
  ],
  ['dark-e2', 'd=e&m=1&theme=dark'],
  ['dark-e4', 'd=e&m=3&theme=dark'],
  ['dark-a2', 'd=a&m=1&theme=dark'],
  ['dark-a5', 'd=a&m=4&theme=dark'],
  ['dark-b1', 'd=b&m=0&theme=dark'],
  ['dark-c1', 'd=c&m=0&theme=dark'],
  ['dark-b2', 'd=b&m=1&theme=dark'],
  ['dark-d2', 'd=d&m=1&theme=dark'],
]

const only = process.argv.slice(2)
const browser = await chromium.launch()
for (const [name, query, act] of shots) {
  if (only.length > 0 && !only.some((one) => name.startsWith(one))) continue
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => process.stdout.write(`  ${String(name)}: ${error.message}\n`))
  await page.goto(`${LAB}/?${String(query)}`)
  await settled(page)
  if (act !== undefined) {
    await act(page)
    await settled(page)
  }
  await page.screenshot({ path: join(out, `${String(name)}.png`) })
  // Save to repo's popover, close up, with a little of the window around it.
  const pop = (await page.locator('[data-picker]').count()) > 0 ? await page.locator('[data-picker]').boundingBox() : null
  if (pop !== null) {
    const x = Math.max(0, pop.x - 24)
    const y = Math.max(0, pop.y - 64)
    await page.screenshot({
      path: join(out, 'crops', `${String(name)}-pop.png`),
      clip: { x, y, width: Math.min(size.width - x, pop.width + 48), height: Math.min(size.height - y, pop.height + 88) },
    })
  }
  process.stdout.write(`${String(name)}\n`)
  await page.close()
}
await browser.close()
