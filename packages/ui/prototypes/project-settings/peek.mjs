// Scrappy: one look at the page, headless, at 1×: node peek.mjs <query-and-hash> <out.png> [width] [height] [click-selector | key:X | wait:ms …]
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../../../apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const [path, out, width = '1440', height = '900', ...clicks] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
await page.goto(`http://localhost:5362/${path}`)
await page.waitForTimeout(1800)
for (const click of clicks) {
  if (click.startsWith('key:')) await page.keyboard.press(click.slice(4))
  else if (click.startsWith('wait:')) await page.waitForTimeout(Number(click.slice(5)))
  else if (click.startsWith('text:')) await page.getByText(click.slice(5), { exact: true }).first().click()
  else await page.locator(click).first().click()
  await page.waitForTimeout(600)
}
await page.screenshot({ path: out })
process.stdout.write(`${page.url()}\n`)
if (errors.length > 0) process.stdout.write(`${errors.join('\n')}\n`)
await browser.close()
