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

const BOARD = '#/projects/p1?room=board'
const WIDE = 1440

const RULES = '#/projects/p1?room=settings&section=rules'
const FEW = '#/threads/th-adr'
const MANY = '#/threads/th-runs'
/** Only the window's bar and what's just under it. */
const BAR = { x: 0, y: 0, width: 1280, height: 140 }
/** The bar's right half and the popover under it. */
const POP = { x: 400, y: 0, width: 880, height: 640 }

const shots = [
  // 1 · A task a lead started; the coordinator in a task's thread.
  { id: '1a-1-board', s: 'lineage', d: 'A', hash: BOARD, width: WIDE, go: () => undefined },
  { id: '1a-2-parent', s: 'lineage', d: 'A', hash: FEW, height: 1000, go: (page) => to(page, 'ADR-097 is drafted', 'start') },
  { id: '1a-3-child', s: 'lineage', d: 'A', hash: '#/threads/th-codex-net', go: () => undefined },
  { id: '1b-1-board', s: 'lineage', d: 'B', hash: BOARD, width: WIDE, go: () => undefined },
  { id: '1b-2-parent', s: 'lineage', d: 'B', hash: FEW, height: 1000, go: (page) => to(page, 'ADR-097 is drafted', 'start') },
  { id: '1b-3-parent-end', s: 'lineage', d: 'B', hash: FEW, height: 900, go: (page) => to(page, 'woke the lead') },

  // 2 · What asks: in the project (A, chosen).
  { id: '2a-1-rules', s: 'rules', d: 'A', hash: RULES, height: 1300, go: () => undefined },
  { id: '2a-2-ask', s: 'rules', d: 'A', hash: MANY, height: 900, go: () => undefined },

  // 3 · MCP servers and skills: the role table and one switch (chosen); what it writes, before it starts (A, chosen).
  { id: '3a-1-off', s: 'tools', d: 'A', hash: '#/settings/mcp', clip: { x: 324, y: 60, width: 916, height: 420 }, go: () => undefined },
  {
    id: '3a-2-dialog',
    s: 'tools',
    d: 'A',
    hash: '#/settings/mcp',
    height: 900,
    go: (page) => page.getByRole('switch', { name: 'Keep your agents’ servers the same' }).click(),
  },
  {
    id: '3a-3-on',
    s: 'tools',
    d: 'A',
    hash: '#/settings/mcp',
    height: 1000,
    go: async (page) => {
      await page.getByRole('switch', { name: 'Keep your agents’ servers the same' }).click()
      await press(page, 'Turn on')
    },
  },
  {
    id: '3a-4-week',
    s: 'tools',
    d: 'A',
    q: '&week',
    hash: '#/settings/mcp',
    height: 1000,
    go: () => undefined,
  },
  {
    id: '3a-5-week-menu',
    s: 'tools',
    d: 'A',
    q: '&week',
    hash: '#/settings/mcp',
    height: 1100,
    keep: true,
    go: async (page) => {
      await to(page, 'MCP servers', 'start')
      await page.getByRole('button', { name: 'figma in your agents' }).click()
    },
  },
  {
    id: '3a-6-week-off',
    s: 'tools',
    d: 'A',
    q: '&week',
    hash: '#/settings/mcp',
    clip: { x: 324, y: 60, width: 916, height: 300 },
    go: (page) => page.getByRole('switch', { name: 'Keep your agents’ servers the same' }).click(),
  },
  {
    id: '3-4-thread',
    s: 'tools',
    d: 'A',
    hash: '#/threads/th-design',
    height: 1000,
    go: async (page) => {
      await page.getByRole('button', { name: /could see/ }).click()
      await unfold(page)
    },
  },

  // 4 · Settings an agent changed (A, chosen).
  { id: '4a-1-coordinator', s: 'tune', d: 'A', hash: '#/projects/p1?room=talk', go: () => undefined },
  { id: '4a-2-settings', s: 'tune', d: 'A', hash: '#/projects/p1?room=settings&section=general', height: 760, go: () => undefined },
  {
    id: '4a-3-rules-allowed',
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

  // 3 · Skills, a section of its own, with its own switch.
  { id: '3s-1-off', s: 'tools', d: 'A', hash: '#/settings/skills', height: 1000, go: () => undefined },
  {
    id: '3s-2-on',
    s: 'tools',
    d: 'A',
    hash: '#/settings/skills',
    height: 1000,
    go: (page) => page.getByRole('switch', { name: 'Keep your agents’ skills the same' }).click(),
  },

  // 5 · A task's parts: C, chosen: the parts' icons just before the faces, and what each opens.
  { id: '5t-1-today', s: 'parts', d: 'Today', hash: MANY, clip: BAR, go: () => undefined },
  { id: '5c-1-few', s: 'parts', d: 'C', hash: FEW, clip: BAR, go: () => undefined },
  {
    id: '5c-2-many',
    s: 'parts',
    d: 'C',
    hash: MANY,
    keep: true,
    clip: POP,
    go: (page) => page.getByRole('button', { name: /^Parts/ }).click(),
  },

  {
    id: '5c-3-check',
    s: 'parts',
    d: 'C',
    hash: MANY,
    keep: true,
    clip: POP,
    go: async (page) => {
      await page.getByRole('button', { name: /^Parts/ }).click()
      await press(page, 'See the check')
    },
  },
  {
    id: '5c-4-worktree',
    s: 'parts',
    d: 'C',
    hash: MANY,
    keep: true,
    clip: POP,
    go: async (page) => {
      await page.getByRole('button', { name: /^Parts/ }).click()
      await press(page, 'Worktree')
    },
  },
  {
    id: '5c-5-merged',
    s: 'parts',
    d: 'C',
    hash: MANY,
    keep: true,
    clip: POP,
    go: async (page) => {
      await page.getByRole('button', { name: /^Parts/ }).click()
      await press(page, 'Merge')
    },
  },
  {
    id: '5c-6-add',
    s: 'parts',
    d: 'C',
    hash: MANY,
    keep: true,
    clip: POP,
    go: async (page) => {
      await page.getByRole('button', { name: /^Parts/ }).click()
      await press(page, 'Add')
    },
  },
  {
    id: '5c-7-add-review',
    s: 'parts',
    d: 'C',
    hash: MANY,
    keep: true,
    clip: POP,
    go: async (page) => {
      await page.getByRole('button', { name: /^Parts/ }).click()
      await press(page, 'Add')
      await press(page, /A review/)
    },
  },
  {
    id: '5c-8-add-access',
    s: 'parts',
    d: 'C',
    hash: MANY,
    keep: true,
    clip: POP,
    go: async (page) => {
      await page.getByRole('button', { name: /^Parts/ }).click()
      await press(page, 'Add')
      await press(page, /^Access/)
    },
  },
  {
    id: '5c-9-added',
    s: 'parts',
    d: 'C',
    hash: MANY,
    keep: true,
    clip: POP,
    go: async (page) => {
      await page.getByRole('button', { name: /^Parts/ }).click()
      await press(page, 'Add')
      await press(page, /A review/)
      await press(page, 'Start')
    },
  },

  // 6 · Sketches.
  { id: '6-1-review', s: 'sketches', d: 'A', hash: '#/threads/th-review', go: () => undefined },
  { id: '6-2-self-push', s: 'sketches', d: 'A', hash: '#/threads/th-codex-net', go: () => undefined },
  { id: '6-3-small', s: 'sketches', d: 'A', hash: '#/threads/th-typo', go: () => undefined },
  { id: '6-5-server-fails', s: 'sketches', d: 'A', hash: '#/threads/th-design', go: () => undefined },
  { id: '6-6-batch', s: 'sketches', d: 'A', hash: '#/threads/th-adr', go: (page) => to(page, 'Started 4 tasks') },

  // 7 · Situations, one state each, where each happens.
  { id: '7-1-away', s: 'situations', d: 'A', hash: BOARD, width: WIDE, height: 760, go: () => undefined },
  { id: '7-2-no-coordinator', s: 'situations', d: 'A', q: '&off', hash: '#/projects/p1?room=talk', height: 700, go: () => undefined },
  { id: '7-3-never', s: 'situations', d: 'A', hash: '#/threads/th-small', height: 700, go: unfold },
  { id: '7-4-ask-waits', s: 'situations', d: 'A', hash: MANY, height: 1000, go: () => undefined },
  { id: '7-5-child-stops', s: 'situations', d: 'A', hash: FEW, height: 900, go: (page) => to(page, 'stopped without a change') },
  { id: '7-6-same-files', s: 'situations', d: 'A', hash: '#/threads/th-command', height: 760, go: (page) => page.keyboard.press('c') },
  { id: '7-7-lighter', s: 'situations', d: 'A', hash: '#/threads/th-review', height: 700, go: () => undefined },
]

const browser = await chromium.launch()
for (const shot of shots.filter((one) => only.length === 0 || only.some((id) => one.id.startsWith(id)))) {
  const page = await browser.newPage({ viewport: { width: shot.width ?? 1280, height: shot.height ?? 820 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://localhost:5367/?s=${shot.s}&d=${shot.d}&bare${shot.q ?? ''}${shot.hash}`)
  await settle(page, 1600)
  try {
    await shot.go(page)
    // Off the buttons, so no tooltip stands over what was done.
    if (shot.keep !== true) {
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
  await page.screenshot({ path: resolve(out, `${shot.id}.png`), ...(shot.clip === undefined ? {} : { clip: shot.clip }) })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
await browser.close()
