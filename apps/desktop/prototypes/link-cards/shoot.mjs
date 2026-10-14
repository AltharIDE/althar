// Scrappy: every shot in shots.json, headless, into the task's scratch folder: node shoot.mjs [id…]
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const here = import.meta.dirname
const repo = resolve(here, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')
const shots = JSON.parse(readFileSync(resolve(here, 'shots.json'), 'utf8'))

const out = resolve(repo, '.althar/scratch/link-cards/shots')
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)

const browser = await chromium.launch()
for (const shot of shots.filter((one) => only.length === 0 || only.includes(one.id))) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  const [path, hash] = shot.page.split('#')
  // The switcher shows only where the shot is of it; every other shot is the app alone.
  const url = `http://localhost:5377/${path}${shot.bar ? '' : `${path.includes('?') ? '&' : '?'}bare`}${hash === undefined ? '' : `#${hash}`}`
  await page.goto(url)
  await page.waitForTimeout(1600)
  for (const target of shot.hover ?? []) {
    await page.locator(target).first().hover()
    await page.waitForTimeout(700)
  }
  for (const target of shot.click ?? []) {
    await page.locator(target).first().click()
    await page.waitForTimeout(700)
  }
  if (shot.away) {
    await page.mouse.move(4, 4)
    await page.waitForTimeout(700)
  }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`) })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
await browser.close()
