// Scrappy: one look at a page of this prototype, headless, at 1×, with its errors: node peek.mjs <path-and-query> <out.png> [width] [height] [step…]
// A step is a selector to click, key:<key>, type:<text>, wait:<ms>, hover:<x>,<y>, click:<x>,<y>, or frame-click:<selector> (in the page's frame).
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../../../apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const [path, out, width = '1280', height = '800', ...steps] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
await page.goto(`http://localhost:${process.env.PORT ?? 5372}/${path}`)
await page.waitForTimeout(2000)
for (const step of steps) {
  if (step.startsWith('key:')) await page.keyboard.press(step.slice(4))
  else if (step.startsWith('type:')) await page.keyboard.type(step.slice(5))
  else if (step.startsWith('wait:')) await page.waitForTimeout(Number(step.slice(5)))
  else if (step.startsWith('hover:')) {
    const [x, y] = step.slice(6).split(',').map(Number)
    await page.mouse.move(x, y)
  } else if (step.startsWith('wheel:')) await page.mouse.wheel(0, Number(step.slice(6)))
  else if (step.startsWith('shot:')) await page.screenshot({ path: step.slice(5) })
  else if (step.startsWith('click:')) {
    const [x, y] = step.slice(6).split(',').map(Number)
    await page.mouse.click(x, y)
  } else await page.locator(step).first().click()
  await page.waitForTimeout(400)
}
if (out !== '-') await page.screenshot({ path: out })
process.stdout.write(`${page.url()}\n`)
if (errors.length > 0) process.stdout.write(`${errors.join('\n')}\n`)
await browser.close()
