// Scrappy: one look at the page, headless, at 1x, with what it logged: node peek.mjs '<query>' [out.png] [wait ms] [x,y,w,h] [reduce]. The server must be up.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../package.json'))
const { chromium } = require('@playwright/test')

const [query = '', out = resolve(import.meta.dirname, 'shots/peek.png'), wait = '3000', clipped, reduce] = process.argv.slice(2)
const [x, y, width, height] = clipped === undefined || clipped === '-' ? [] : clipped.split(',').map(Number)
mkdirSync(dirname(out), { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  ...(reduce === 'reduce' ? { reducedMotion: 'reduce' } : {}),
})
page.on('pageerror', (error) => process.stdout.write(`pageerror: ${String(error)}\n`))
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') process.stdout.write(`${message.type()}: ${message.text()}\n`)
})
await page.goto(`http://localhost:5397/${query}`)
await page.waitForTimeout(Number(wait))
await page.screenshot({ path: out, ...(x === undefined ? {} : { clip: { x, y, width, height } }) })
process.stdout.write(`${page.url()}\n`)
await browser.close()
