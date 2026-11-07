// Scrappy: every shot in shots.json, headless, into the task's scratch folder: node shoot.mjs [id…]
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import shots from './shots.json' with { type: 'json' }

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const out = resolve(repo, '.althar/scratch/run-place/shots')
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)

const browser = await chromium.launch()
for (const shot of shots.filter((one) => only.length === 0 || only.includes(one.id))) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://localhost:5358/${shot.page}`)
  await page.waitForTimeout(1500)
  for (const click of shot.click ?? []) {
    await page.locator(click).first().click()
    await page.waitForTimeout(600)
  }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`) })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
await browser.close()
