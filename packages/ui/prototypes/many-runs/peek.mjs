// Scrappy: one look at a page, headless: node peek.mjs <path-and-query> <out.png> [width] [height] [click-selector…]
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../../../apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const [path, out, width = '1280', height = '800', ...clicks] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
await page.goto(`http://localhost:5356/${path}`)
await page.waitForTimeout(1500)
for (const click of clicks) {
  if (click.startsWith('key:')) await page.keyboard.press(click.slice(4))
  else if (click.startsWith('wait:')) await page.waitForTimeout(Number(click.slice(5)))
  else await page.locator(click).first().click()
  await page.waitForTimeout(500)
}
await page.screenshot({ path: out })
if (errors.length > 0) process.stdout.write(`${errors.join('\n')}\n`)
await browser.close()
