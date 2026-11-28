// Records the pill opening, folding, and turning back mid-way into shots/<name>.webm: node record.mjs <name> <query> (the lab must be running on 6143).
import { mkdirSync, renameSync } from 'node:fs'
import { chromium } from '../../../../node_modules/.bun/playwright@1.65.1/node_modules/playwright/index.mjs'

const [name = 'morph', query = 'd=pill&m=back&w=coordinator'] = process.argv.slice(2)
const out = new URL('./shots/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const size = { width: 1000, height: 720 }
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: out, size } })
const page = await context.newPage()
await page.goto(`http://localhost:6143/?${query}&open=0`)
await page.waitForTimeout(900)
const pill = () => page.locator('button[aria-expanded="false"][aria-label^="Merging"]')
const head = () => page.locator('section[aria-label="Merging"] button[aria-expanded="true"]')
await pill().click()
await page.waitForTimeout(1100)
await head().click()
await page.waitForTimeout(1100)
// Opened, then folded again before it lands: it turns back from where it is.
await pill().click()
await page.waitForTimeout(150)
await head().click()
await page.waitForTimeout(1100)
const video = page.video()
await context.close()
renameSync(await video.path(), `${out}${name}.webm`)
await browser.close()
