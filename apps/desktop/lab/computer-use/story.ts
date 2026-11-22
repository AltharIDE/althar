import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

// Shoots stories of the kit's Storybook (on 6116), light or dark, at 1×, into lab/computer-use/shots.
const [name = 'story', ids = '', width = '760', theme = 'light'] = process.argv.slice(2)
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
for (const id of ids.split(',')) {
  const page = await browser.newPage({ viewport: { width: Number(width), height: 300 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.error('page error:', error.message))
  await page.goto(`http://127.0.0.1:6116/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`)
  await page.waitForSelector('#storybook-root > *', { timeout: 60_000 })
  await page.waitForTimeout(900)
  if (process.env.NO_PLAY !== undefined) await page.reload()
  await page.screenshot({ path: join(out, `${name}-${id}${theme === 'dark' ? '-dark' : ''}.png`), fullPage: true })
  await page.close()
}
await browser.close()
