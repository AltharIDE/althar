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
