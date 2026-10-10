/* Draws the link previews into public/og/. Starts the site's development server in this process, opens /og?page=<page> for each
   card in src/og/cards.tsx at twice its size, waits until the card says it is drawn, and saves what the browser
   drew: scaled down to 1200×630, which keeps the engraving's fine lines crisp, as a palette PNG, small enough that
   every previewer shows it. Run it after changing a card's words or the engraving: `bun run og`. */

import { resolve } from 'node:path'

import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { createServer } from 'vite-plus'

import { OG_PAGES } from '../src/og/cards'

const site = resolve(import.meta.dirname, '..')
const WIDTH = 1200
const HEIGHT = 630

const server = await createServer({ root: site, configFile: resolve(site, 'vite.config.ts'), server: { port: 0 }, logLevel: 'error' })
await server.listen()

try {
  const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!origin) throw new Error('the development server has no address')
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 })
  for (const page of OG_PAGES) {
    const tab = await context.newPage()
    await tab.goto(`${origin}/og?page=${page}`)
    await tab.waitForSelector('[data-ready]', { timeout: 30_000 })
    const shot = await tab.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
    const out = resolve(site, `public/og/${page}.png`)
    await sharp(shot).resize(WIDTH, HEIGHT).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(out)
    process.stdout.write(`public/og/${page}.png\n`)
    await tab.close()
  }
  await browser.close()
} finally {
  await server.close()
}
