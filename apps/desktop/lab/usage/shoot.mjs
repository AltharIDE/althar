// Shoots the usage lab's window at 1×, into lab/usage/shots (git ignores it), with the lab running on 6188; prints what the
// page logged as an error. Chromium can't start in an agent's sandbox on a Mac; run it outside.
//
//   node lab/usage/shoot.mjs                     every direction, light and dark, at 30 days
//   node lab/usage/shoot.mjs one a dark 1440 900 "range=90&all=1"   one, as asked; full=1 for the whole page's height
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()

const say = (...words) => process.stdout.write(`${words.join(' ')}\n`)

const shoot = async (name, query, width = 1440, height = 900, full = false) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => say(`[${name}] page error:`, error.message))
  page.on('console', (message) => message.type() === 'error' && say(`[${name}] console:`, message.text().slice(0, 300)))
  await page.goto(`http://localhost:6188/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForSelector('[data-direction]', { timeout: 60_000 }).catch(() => say(`[${name}] no page`))
  await page.waitForTimeout(1200)
  if (full) {
    // The page scrolls inside the window: let the window grow to it.
    const tall = await page.evaluate(() => {
      const view = Array.from(document.querySelectorAll('[data-lab-window] *')).find(
        (node) => node.scrollHeight > node.clientHeight + 40 && getComputedStyle(node).overflowY === 'auto',
      )
      return view === undefined ? 0 : view.scrollHeight - view.clientHeight
    })
    await page.setViewportSize({ width, height: height + tall })
    await page.waitForTimeout(500)
  }
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  await page.close()
  say('shot', name)
}

const [, , mode, d = 'a', theme = 'light', width = '1440', height = '900', extra = ''] = process.argv
if (mode === 'one') {
  const full = extra.includes('full=1')
  await shoot(
    `${d}-${theme}${extra === '' ? '' : `-${extra.replace(/[^a-z0-9]+/gi, '-')}`}`,
    `d=${d}${theme === 'dark' ? '&theme=dark' : ''}${extra === '' ? '' : `&${extra}`}`,
    Number(width),
    Number(height),
    full,
  )
} else {
  for (const d of ['a', 'b', 'c', 'd'])
    for (const theme of ['light', 'dark']) await shoot(`${d}-${theme}`, `d=${d}${theme === 'dark' ? '&theme=dark' : ''}`, 1440, 900, true)
  for (const d of ['a', 'b', 'c', 'd']) await shoot(`${d}-narrow`, `d=${d}&narrow=1&range=90`, 1100, 900, false)
}
await browser.close()
