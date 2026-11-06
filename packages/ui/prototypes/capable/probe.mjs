// Scrappy: opens one address of the page headless and prints what went wrong in it: node probe.mjs '<url>'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (error) => console.error('pageerror', error.stack ?? error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.error('console', message.text().slice(0, 1500))
})
await page.goto(process.argv[2])
await page.waitForTimeout(1500)
if (process.argv[3]) {
  await page.getByRole('radio', { name: process.argv[3] }).first().click()
  await page.waitForTimeout(1500)
  console.error('url', page.url())
}
await browser.close()
