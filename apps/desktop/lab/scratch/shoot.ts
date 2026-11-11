import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

/*
 * Shoots the Scratch lab (README.md), headless, at 1×, into lab/scratch/shots,
 * with the lab running (Scratch lab, on port 6147):
 *
 *   node lab/scratch/shoot.ts
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6147'

type Step = (page: Page) => Promise<void>
const click =
  (selector: string): Step =>
  async (page) => {
    await page.locator(selector).first().click()
    await page.waitForTimeout(500)
  }
const text =
  (role: 'button' | 'tab', name: string | RegExp): Step =>
  async (page) => {
    await page.getByRole(role, { name }).first().click()
    await page.waitForTimeout(500)
  }
const hover =
  (name: string): Step =>
  async (page) => {
    await page.getByText(name, { exact: true }).first().hover()
    await page.waitForTimeout(250)
  }

const SHOTS: ReadonlyArray<{ name: string; d: string; l: number; theme?: string; steps?: ReadonlyArray<Step> }> = [
  { name: '1-A-today', d: 'A', l: 0, steps: [text('button', /^Scratch · /)] },
  { name: '2-B-chats-view', d: 'B', l: 0, steps: [click('[aria-pressed][title^="Chats"]'), hover('Which Stripe API version are we on?')] },
  { name: '3-B-chat-open', d: 'B', l: 0, steps: [click('[aria-pressed][title^="Chats"]'), click('li button:has-text("Stripe API")')] },
  { name: '4-B-dark-board-only', d: 'B', l: 2, theme: 'dark', steps: [click('[aria-pressed][title^="Chats"]')] },
  { name: '5-C-aside-open', d: 'C', l: 0, steps: [text('tab', /retry back off/)] },
  { name: '6-C-older', d: 'C', l: 0, theme: 'dark', steps: [text('button', /older$/)] },
  { name: '7-C-new-aside', d: 'C', l: 1, steps: [text('button', 'New aside')] },
  { name: '8-D-tray-board-only', d: 'D', l: 2, theme: 'dark', steps: [click('button[aria-expanded]:has-text("Chats")')] },
  {
    name: '9-D-tray-chat-open',
    d: 'D',
    l: 1,
    steps: [click('button[aria-expanded]:has-text("Chats")'), click('li button:has-text("nightly backup")')],
  },
  { name: '10-E-no-place', d: 'E', l: 0 },
  { name: '11-E-dark-conversation-only', d: 'E', l: 1, theme: 'dark' },
]

const browser = await chromium.launch()
const only = process.argv[2]
if (only === 'bars') {
  await bars()
  await browser.close()
  process.exit(0)
}
if (only === 'asides') {
  await asides()
  await browser.close()
  process.exit(0)
}
for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.error(shot.name, 'page error:', error.message))
  await page.goto(`http://localhost:${port}/?d=${shot.d}&l=${shot.l}&theme=${shot.theme ?? 'light'}`)
  await page.waitForTimeout(1200)
  for (const step of shot.steps ?? []) await step(page)
  await page.screenshot({ path: join(out, `${shot.name}.png`) })
  process.stdout.write(`${shot.name}\n`)
  await page.close()
}
await browser.close()

/** The asides, picked: the coordinator's marks, an aside made a task as it flies to the board, and an aside from selected words. */
async function asides() {
  const open = async (query: string, width = 1360, height = 820) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => console.error('page error:', error.message))
    await page.goto(`http://localhost:${port}/?d=C&${query}`)
    await page.waitForTimeout(1200)
    return page
  }
  const top = async (page: Page) => {
    await page.evaluate(() =>
      [...document.querySelectorAll('[class*="Project-module__talk"] article[class*="Turn-module__turn"]')]
        .find((one) => one.textContent?.includes('It backs off in two places'))
        ?.scrollIntoView({ block: 'center' }),
    )
    await page.waitForTimeout(400)
  }
  const shoot = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => {
    await page.screenshot({ path: join(out, `${name}.png`), ...(clip === undefined ? {} : { clip }) })
    process.stdout.write(`${name}\n`)
  }
  // The marks, each on the conversation's tab and its turns.
  for (const [at, mark] of ['althar', 'project', 'glyph', 'word'].entries()) {
    for (const theme of at === 0 ? ['light', 'dark'] : ['light']) {
      const page = await open(`l=1&m=${mark}&theme=${theme}`)
      await top(page)
      await shoot(page, `c1-mark-${at + 6}-${mark}${theme === 'dark' ? '-dark' : ''}`, { x: 0, y: 44, width: 1360, height: 560 })
      await page.close()
    }
  }
  // An aside asked for work: the agent makes it a task, it flies to Up next, the tab closes.
  {
    const page = await open('l=0&m=althar&theme=light')
    await page.getByRole('tab', { name: /retry back off/ }).click()
    await page.waitForTimeout(400)
    const box = page.getByRole('textbox').last()
    await box.click()
    await page.keyboard.type('Can you go ahead and fix it?')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-aside] [class*="TaskLaunch-module__launch"]')
    await page.waitForTimeout(150)
    await shoot(page, 'c2-work-1-agent-decides')
    await page.waitForSelector('[class*="asides-module__ghost"]', { state: 'attached' })
    await page.waitForTimeout(120)
    await shoot(page, 'c2-work-2-flying')
    await page.waitForSelector('[data-arrived]', { state: 'attached' })
    await page.waitForTimeout(250)
    await shoot(page, 'c2-work-3-landed')
    await page.close()
  }
  // With the board closed, it flies to the Board tab.
  {
    const page = await open('l=1&m=althar&theme=dark')
    await page.getByRole('tab', { name: /retry back off/ }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Make it a task' }).click()
    await page.waitForTimeout(300)
    await shoot(page, 'c3-work-board-closed-flying')
    await page.waitForSelector('[data-arrived]', { state: 'attached' })
    await shoot(page, 'c3-work-board-closed-landed', { x: 0, y: 44, width: 1360, height: 300 })
    await page.close()
  }
  // Words the coordinator said, selected: Ask in an aside, then the aside with the quote.
  {
    const page = await open('l=0&m=althar&theme=light')
    await top(page)
    await page.locator('p', { hasText: 'It backs off in two places' }).first().click({ clickCount: 3 })
    await page.waitForTimeout(400)
    await shoot(page, 'c4-select-1-ask')
    await page.getByRole('button', { name: 'Ask in an aside' }).click()
    await page.waitForTimeout(400)
    await shoot(page, 'c4-select-2-quoted')
    await page.getByRole('textbox').last().click()
    await page.keyboard.type('Which one is safe to drop?')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1400)
    await shoot(page, 'c4-select-3-answered')
    await page.close()
  }
}

/** The asides' bar, in each look, and the bar inside an open aside, in each. */
async function bars() {
  const open = async (query: string) => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => console.error('page error:', error.message))
    await page.goto(`http://localhost:${port}/?d=C&${query}`)
    await page.waitForTimeout(1200)
    return page
  }
  const talk = async (page: Page, height = 330) => {
    const box = await page.locator('[class*="Project-module__talk"]').first().boundingBox()
    return { x: box!.x, y: box!.y, width: box!.width, height }
  }
  const shoot = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => {
    await page.screenshot({ path: join(out, `${name}.png`), ...(clip === undefined ? {} : { clip }) })
    process.stdout.write(`${name}\n`)
  }
  const aside = async (page: Page) => {
    await page.locator('[class*="asides-module__strip"]').getByText('Why does the retry', { exact: false }).first().click()
    await page.waitForTimeout(500)
  }
  const viaSwitch = async (page: Page) => {
    await page.locator('[class*="asides-module__switch__"]').click()
    await page.getByRole('menuitem', { name: /Why does the retry/ }).click()
    await page.waitForTimeout(500)
  }
  // Each bar: on the coordinator, and with an aside open, in light; the conversation alone in dark.
  for (const [at, bar] of ['pills', 'tabs', 'sheets', 'title', 'switch'].entries()) {
    const page = await open(`l=0&b=${bar}&i=head&theme=light`)
    await shoot(page, `d${at + 4}-${bar}-1-coordinator`, await talk(page, 120))
    if (bar === 'switch') {
      await page.locator('[class*="asides-module__switch__"]').click()
      await page.waitForTimeout(400)
      await shoot(page, `d${at + 4}-${bar}-2-menu`, { ...(await talk(page, 360)), width: 560 })
      await page.keyboard.press('Escape')
      await viaSwitch(page)
    } else await aside(page)
    await shoot(page, `d${at + 4}-${bar}-3-aside`, await talk(page, 150))
    await page.close()
    const dark = await open(`l=1&b=${bar}&i=head&theme=dark`)
    await shoot(dark, `d${at + 4}-${bar}-4-dark-wide`, { x: 0, y: 44, width: 1360, height: 110 })
    await dark.close()
  }
  // Each inner bar, under the pills (and the Switcher for In the tab, which holds the moves too).
  for (const [inner, bar] of [
    ['head', 'pills'],
    ['tab', 'pills'],
    ['tab', 'switch'],
    ['composer', 'pills'],
    ['context', 'pills'],
  ] as const) {
    const page = await open(`l=0&b=${bar}&i=${inner}&theme=light`)
    if (bar === 'switch') await viaSwitch(page)
    else await aside(page)
    const clip = await talk(page, 0)
    await shoot(page, `e-${inner}-${bar}`, { ...clip, height: 820 - clip.y - 40 })
    if (inner === 'tab') {
      await page.getByRole('button', { name: 'This aside' }).click()
      await page.waitForTimeout(400)
      await shoot(page, `e-${inner}-${bar}-menu`, { ...clip, height: 240 })
      await page.keyboard.press('Escape')
    }
    await page.close()
  }
  // Where it came from, for an aside started from the coordinator's words.
  {
    const page = await open('l=0&b=pills&i=context&theme=light')
    await page.locator('p', { hasText: 'It backs off in two places' }).first().click({ clickCount: 3 })
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Ask in an aside' }).click()
    await page.getByRole('textbox').last().click()
    await page.keyboard.type('Which one is safe to drop?')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1400)
    await shoot(page, 'e-context-quoted', await talk(page, 150))
    await page.close()
  }
  // The coordinator's line, once an aside became a task.
  {
    const page = await open('l=0&b=pills&i=head&theme=light')
    await aside(page)
    await page.getByRole('button', { name: 'Make it a task' }).click()
    await page.waitForSelector('[data-arrived]', { state: 'attached' })
    await page.waitForTimeout(900)
    const clip = await talk(page, 0)
    await shoot(page, 'f-note', { ...clip, y: clip.y + 200, height: 820 - clip.y - 240 })
    await page.close()
  }
}
