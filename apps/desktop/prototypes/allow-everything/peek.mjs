// Scrappy: one look at the page, headless, with what it logged: node peek.mjs '<query>' [out.png] [click selector…]. The server must be up.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../package.json'))
const { chromium } = require('@playwright/test')

const [query = '', out = resolve(import.meta.dirname, 'shots/peek.png'), ...steps] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => process.stdout.write(`pageerror: ${String(error)}\n`))
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') process.stdout.write(`${message.type()}: ${message.text()}\n`)
})
await page.goto(`http://localhost:5361/${query}`)
await page.waitForTimeout(2500)
for (const step of steps) {
  if (step.startsWith('key:')) await page.keyboard.press(step.slice(4))
  else if (step.startsWith('wait:')) await page.waitForTimeout(Number(step.slice(5)))
  else await page.locator(step).first().click()
  await page.waitForTimeout(500)
}
await page.screenshot({ path: out })
process.stdout.write(`${page.url()}\n`)
await browser.close()
