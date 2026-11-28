// Takes the lab's shots into shots/: node shoot.mjs (the lab must be running on 6143).
import { mkdirSync } from 'node:fs'
import { chromium } from '../../../../node_modules/.bun/playwright@1.65.1/node_modules/playwright/index.mjs'

const out = new URL('./shots/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const shots = process.argv[2] ? [process.argv.slice(2)] : JSON.parse(process.env.SHOTS ?? '[]')
const browser = await chromium.launch()
for (const [name, query, width = '1000', height = '720', wait = '400'] of shots) {
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6143/?${query}`)
  await page.waitForTimeout(Number(wait))
  await page.screenshot({ path: `${out}${name}.png` })
  await page.close()
}
await browser.close()
