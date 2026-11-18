import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the device lab (README.md), headless, at 1×, into lab/device/shots, which git leaves alone: each direction
 * running, then the states that matter, with the lab running (on port 6141):
 *
 *   node lab/device/shoot.mjs [width] [height]
 */

const [width = '1440', height = '900'] = process.argv.slice(2)
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6141'

const shots = [
  ['a', 'd=a'],
  ['b', 'd=b'],
  ['c', 'd=c'],
  ['d', 'd=d'],
  ['a-starting', 'd=a&starting=1'],
  ['a-no-xcode', 'd=a&unavailable=1'],
  ['c-no-xcode', 'd=c&unavailable=1'],
  ['c-lead', 'd=c&lead=1&screen=where'],
  ['b-narrow', 'd=b&narrow=1'],
]

// LAB_CHROMIUM names a Chromium of the computer's own where Playwright's isn't installed.
const browser = await chromium.launch(process.env.LAB_CHROMIUM === undefined ? {} : { executablePath: process.env.LAB_CHROMIUM })
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => console.error('page error:', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.error('page:', message.text())
})
for (const [name, query] of shots) {
  await page.goto(`http://localhost:${port}/?${query}`)
  await page.waitForSelector('section[aria-label="Thread"] [data-virtual-gap]', { state: 'attached' })
  await page.waitForTimeout(name.endsWith('lead') ? 2900 : 700)
  const path = join(out, `${name}.png`)
  await page.screenshot({ path })
  process.stdout.write(`${path}\n`)
}
await browser.close()
