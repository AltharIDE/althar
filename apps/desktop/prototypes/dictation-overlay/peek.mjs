// Throwaway: one look at the page, headless: node peek.mjs '<query>' out.png [step…]. A step is a selector to click, key:<key>, or wait:<ms>.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../package.json'))
const { chromium } = require('@playwright/test')

const [query = '', out = 'peek.png', ...steps] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
await page.goto(`http://localhost:5397/${query}`)
await page.waitForTimeout(2500)
// clip:x,y,w,h shoots only that part of the page.
let clip
for (const step of steps) {
  if (step.startsWith('size:')) {
    const [width, height] = step.slice(5).split(',').map(Number)
    await page.setViewportSize({ width, height })
  } else if (step.startsWith('clip:')) {
    const [x, y, width, height] = step.slice(5).split(',').map(Number)
    clip = { x, y, width, height }
  } else if (step.startsWith('wait:')) await page.waitForTimeout(Number(step.slice(5)))
  else if (step.startsWith('key:')) await page.keyboard.press(step.slice(4))
  else await page.locator(step).first().click()
  await page.waitForTimeout(400)
}
await page.screenshot({ path: resolve(import.meta.dirname, 'shots', out), ...(clip === undefined ? {} : { clip }) })
process.stdout.write(`${out} ${page.url()}\n${errors.join('\n')}\n`)
await browser.close()
