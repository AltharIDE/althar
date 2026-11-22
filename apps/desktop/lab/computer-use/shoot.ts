import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

/*
 * Shoots the computer use lab (README.md), headless, at 1×, into
 * lab/computer-use/shots (which git and the end-to-end run leave alone):
 *
 *   node lab/computer-use/shoot.ts <name> [scenes, comma-separated] [width] [height]
 *     each state light and dark: the thread's end, and the card alone
 *
 * With the lab running (Computer use lab, on port 6135). The "unreachable"
 * state presses Take over first, to show what a refused press says.
 */

const [name = 'shot', which = 'ask,display,long,using,observed,paused,stopped,unreachable', width = '900', height = '760'] =
  process.argv.slice(2)
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6135'

const browser = await chromium.launch()
const open = async (scene: string, theme: string): Promise<Page> => {
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('page:', message.text())
  })
  page.on('pageerror', (error) => console.error('page error:', error.stack))
  await page.goto(`http://localhost:${port}/?scene=${scene}&theme=${theme}`)
  await page.waitForSelector('section[aria-label="Thread"] > :not([data-virtual-gap])')
  // The lead's words stream in first.
  await page.waitForTimeout(5000)
  return page
}

for (const scene of which.split(',')) {
  for (const theme of ['light', 'dark']) {
    const page = await open(scene, theme)
    if (scene === 'unreachable') {
      await page.getByRole('button', { name: 'Take over' }).click()
      await page.waitForTimeout(400)
    }
    const suffix = theme === 'dark' ? '-dark' : ''
    await page.screenshot({ path: join(out, `${name}-${scene}${suffix}.png`) })
    const card = page.getByRole('region', { name: 'Computer use' })
    if ((await card.count()) > 0) await card.screenshot({ path: join(out, `${name}-${scene}-card${suffix}.png`) })
    await page.close()
  }
  process.stdout.write(`${name}: ${scene}\n`)
}
await browser.close()
