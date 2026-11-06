// Scrappy: each surface and direction clicked through, headless at 1×, into test-results/capable: node shoot.mjs [id…]
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const out = resolve(repo, 'test-results/capable')
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)

/* ——— What the person does, as clicks. ——— */
const press = (page, name) => page.getByRole('button', { name, exact: true }).first().click()
const radio = (page, name) => page.getByRole('radio', { name, exact: true }).first().click()
const type = async (page, words) => {
  const dialog = page.getByRole('dialog')
  const field = ((await dialog.count()) > 0 ? dialog : page).locator('textarea').first()
  await field.click()
  await field.fill(words)
}
const settle = (page, ms = 500) => page.waitForTimeout(ms)
/** Scrolls what holds these words to the middle of the window. */
const to = (page, words, block = 'center') =>
  page.evaluate(
    ([text, where]) => {
      const all = [...document.querySelectorAll('p, span, h2, h3, h4, strong, button, div')]
      const one = all.find((element) => element.children.length < 3 && element.textContent?.includes(text))
      one?.scrollIntoView({ block: where })
    },
    [words, block],
  )
/** Opens the folded work of the thread's rounds. */
const unfold = async (page) => {
  const lines = page.locator('button[aria-expanded="false"]').filter({ hasText: /Worked|read|ran|used|Called/i })
  const count = await lines.count()
  for (let at = 0; at < count; at++)
    await lines
      .nth(0)
      .click()
      .catch(() => undefined)
}

const BOTH = '#/projects/p1?room=both'
const BOARD = '#/projects/p1?room=board'
const WIDE = 1440

const shots = [
  // 1 · Starting a task without the coordinator.
  { id: '1a-1-dialog', s: 'start', d: 'A', hash: BOTH, width: WIDE, go: (page) => press(page, 'New task') },
  {
    id: '1a-2-dialog-words',
    s: 'start',
    d: 'A',
    hash: BOTH,
    width: WIDE,
    go: async (page) => {
      await press(page, 'New task')
      await type(page, 'Redesign the plan card’s header so the model chip and the countdown don’t wrap at 900px')
    },
  },
  {
    id: '1a-3-dialog-linear',
    s: 'start',
    d: 'A',
    hash: BOTH,
    width: WIDE,
    go: async (page) => {
      await press(page, 'New task')
      await radio(page, 'From Linear')
      await page.getByText('DEV-202', { exact: false }).first().click()
      await page.getByText('DEV-203', { exact: false }).first().click()
    },
  },
  {
    id: '1a-4-dialog-small',
    s: 'start',
    d: 'A',
    hash: BOTH,
    width: WIDE,
    go: async (page) => {
      await press(page, 'New task')
      await radio(page, 'Small change')
      await type(page, 'The Codex sign-in row in Settings truncates without a tooltip')
    },
  },
  {
    id: '1a-5-model',
    s: 'start',
    d: 'A',
    hash: BOTH,
    width: WIDE,
    go: async (page) => {
      await press(page, 'New task')
      await type(page, 'Redesign the plan card’s header so the model chip and the countdown don’t wrap at 900px')
      await page
        .getByRole('button', { name: /^Lead:/ })
        .first()
        .click()
    },
  },
  {
    id: '1a-6-started',
    s: 'start',
    d: 'A',
    hash: BOTH,
    width: WIDE,
    go: async (page) => {
      await press(page, 'New task')
      await radio(page, 'From Linear')
      await page.getByText('DEV-202', { exact: false }).first().click()
      await page.getByText('DEV-203', { exact: false }).first().click()
      await page.getByRole('button', { name: /^Start 3 tasks/ }).click()
      await settle(page, 900)
    },
  },
  {
    id: '1b-1-composer',
    s: 'start',
    d: 'B',
    hash: BOTH,
    width: WIDE,
    go: async (page) => {
      await press(page, 'New task')
      await type(page, 'The Codex sign-in row in Settings truncates without a tooltip')
    },
  },
  {
    id: '1b-2-composer-linear',
    s: 'start',
    d: 'B',
    hash: BOTH,
    width: WIDE,
    go: async (page) => {
      await press(page, 'New task')
      await page
        .getByRole('button', { name: /From Linear/ })
        .first()
        .click()
      await page.getByRole('menuitemcheckbox', { name: /DEV-201/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /DEV-202/ }).click()
    },
  },
  {
    id: '1b-3-composer-started',
    s: 'start',
    d: 'B',
    hash: BOTH,
    width: WIDE,
    go: async (page) => {
      await press(page, 'New task')
      await page.getByRole('button', { name: 'Small change' }).first().click()
      await type(page, 'The Codex sign-in row in Settings truncates without a tooltip')
      await page.locator('textarea').first().press('Enter')
      await settle(page, 900)
    },
  },
  { id: '1c-1-board', s: 'start', d: 'C', hash: BOARD, width: WIDE, go: () => undefined },
  {
    id: '1c-2-board-writing',
    s: 'start',
    d: 'C',
    hash: BOARD,
    width: WIDE,
    height: 900,
    go: async (page) => {
      await page
        .getByRole('button', { name: /^New task/ })
        .last()
        .click()
      await type(page, 'The Codex sign-in row in Settings truncates without a tooltip')
    },
  },
  {
    id: '1c-3-board-started',
    s: 'start',
    d: 'C',
    hash: BOARD,
    width: WIDE,
    go: async (page) => {
      await page
        .getByRole('button', { name: /^New task/ })
        .last()
        .click()
      await type(page, 'The Codex sign-in row in Settings truncates without a tooltip')
      await page
        .getByRole('button', { name: /^Start/ })
        .last()
        .click()
      await settle(page, 900)
    },
  },
  { id: '1t-today', s: 'start', d: 'Today', hash: BOTH, width: WIDE, go: () => undefined },

  // 2 · A task a lead started; the coordinator in a task's thread.
  { id: '2a-1-board', s: 'lineage', d: 'A', hash: BOARD, width: WIDE, go: () => undefined },
  {
    id: '2a-2-parent',
    s: 'lineage',
    d: 'A',
    hash: '#/threads/th-adr',
    height: 1000,
    go: (page) => to(page, 'ADR-097 is drafted', 'start'),
  },
  { id: '2a-3-child', s: 'lineage', d: 'A', hash: '#/threads/th-codex-net', go: () => undefined },
  { id: '2b-1-board', s: 'lineage', d: 'B', hash: BOARD, width: WIDE, go: () => undefined },
  {
    id: '2b-2-parent',
    s: 'lineage',
    d: 'B',
    hash: '#/threads/th-adr',
    height: 1000,
    go: (page) => to(page, 'ADR-097 is drafted', 'start'),
  },
  { id: '2b-3-parent-end', s: 'lineage', d: 'B', hash: '#/threads/th-adr', height: 900, go: (page) => to(page, 'woke the lead') },

  // 3 · What asks.
  { id: '3a-1-rules', s: 'rules', d: 'A', hash: '#/projects/p1?room=settings&section=rules', height: 1300, go: () => undefined },
  { id: '3a-2-ask', s: 'rules', d: 'A', hash: '#/threads/th-runs', height: 900, go: () => undefined },
  { id: '3b-1-rules', s: 'rules', d: 'B', hash: '#/projects/p1?room=settings&section=rules', height: 1100, go: () => undefined },
  { id: '3b-2-ask', s: 'rules', d: 'B', hash: '#/threads/th-runs', height: 900, go: () => undefined },
  { id: '3t-2-ask-today', s: 'rules', d: 'Today', hash: '#/threads/th-runs', height: 900, go: () => undefined },

  // 4 · MCP servers and skills.
  { id: '4a-1-settings', s: 'tools', d: 'A', hash: '#/settings/skills', height: 1700, go: () => undefined },
  {
    id: '4a-2-settings-who',
    s: 'tools',
    d: 'A',
    hash: '#/settings/skills',
    go: async (page) => {
      await page.getByRole('button', { name: 'Every role' }).first().click()
    },
  },
  { id: '4b-1-settings', s: 'tools', d: 'B', hash: '#/settings/skills', height: 1100, go: () => undefined },
  {
    id: '4a-3-thread',
    s: 'tools',
    d: 'A',
    hash: '#/threads/th-design',
    height: 1000,
    go: async (page) => {
      await page.getByRole('button', { name: /could see/ }).click()
      await unfold(page)
    },
  },
  { id: '4b-3-thread', s: 'tools', d: 'B', hash: '#/threads/th-design', height: 900, go: (page) => unfold(page) },
  { id: '4t-3-thread-today', s: 'tools', d: 'Today', hash: '#/threads/th-design', height: 900, go: (page) => unfold(page) },

  // 5 · Sketches.
  {
    id: '5-1-parts',
    s: 'parts',
    d: 'A',
    hash: '#/threads/th-adr',
    go: async (page) => {
      await page.getByRole('button', { name: 'Add' }).first().click()
    },
  },
  { id: '5-2-review', s: 'parts', d: 'A', hash: '#/threads/th-review', go: () => undefined },
  { id: '5-3-self-push', s: 'parts', d: 'A', hash: '#/threads/th-codex-net', go: () => undefined },

  // 6 · Settings an agent changed.
  { id: '6a-1-coordinator', s: 'tune', d: 'A', hash: '#/projects/p1?room=talk', go: () => undefined },
  { id: '6b-1-coordinator', s: 'tune', d: 'B', hash: '#/projects/p1?room=talk', go: () => undefined },
  { id: '6a-2-settings', s: 'tune', d: 'A', hash: '#/projects/p1?room=settings&section=general', height: 760, go: () => undefined },
  {
    id: '6a-3-rules-allowed',
    s: 'tune',
    d: 'A',
    hash: '#/projects/p1?room=talk',
    height: 640,
    go: async (page) => {
      await page.getByRole('button', { name: 'Let them merge' }).click()
      await page.evaluate(() => {
        window.location.hash = '#/projects/p1?room=settings&section=rules'
      })
    },
  },
]

const browser = await chromium.launch()
for (const shot of shots.filter((one) => only.length === 0 || only.some((id) => one.id.startsWith(id)))) {
  const page = await browser.newPage({ viewport: { width: shot.width ?? 1280, height: shot.height ?? 820 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://localhost:5367/?s=${shot.s}&d=${shot.d}&bare${shot.hash}`)
  await settle(page, 1600)
  try {
    await shot.go(page)
    // Off the buttons, so no tooltip stands over what was done.
    if (!/model|who|linear|parts/.test(shot.id)) {
      await page.mouse.move(2, (shot.height ?? 820) - 2)
      await page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.closest('textarea, input') === null &&
          document.activeElement.blur(),
      )
    }
    await settle(page, 700)
  } catch (error) {
    errors.push(String(error).split('\n')[0])
  }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`) })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
await browser.close()
