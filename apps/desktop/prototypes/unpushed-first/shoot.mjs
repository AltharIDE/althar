// Shoots the prototype's windows, headless: node prototypes/unpushed-first/shoot.mjs [only-prefix]. Run outside the sandbox.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5344'
const OUT = join(import.meta.dirname, '../../test-results/unpushed-first')
mkdirSync(OUT, { recursive: true })

const stages = ['none', 'ahead', 'pushing', 'pushed', 'blocked']
const shots = [
  ...['talk', 'out'].flatMap((f, i) => stages.map((s, j) => [`T${i * 5 + j + 1}-today-${f}-${s}`, `d=today&s=${s}&f=${f}`])),
  ...['a', 'b', 'c', 'd', 'e'].flatMap((d) => stages.map((s, j) => [`${d.toUpperCase()}${j + 1}-${s}`, `d=${d}&s=${s}`])),
]
const only = process.argv[2]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 })
page.on('console', (m) => m.type() === 'error' && console.error('  console:', m.text().slice(0, 300)))
page.on('pageerror', (e) => console.error('  pageerror:', e.message.slice(0, 300)))
for (const [name, query] of shots) {
  if (only !== undefined && !name.startsWith(only)) continue
  console.error(name)
  await page.goto(`${BASE}/screen.html?${query}`)
  await page.waitForSelector('#root > *')
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}
for (const p of process.argv.slice(3)) {
  const tall = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  await tall.goto(`${BASE}/${p}.html`)
  await tall.waitForTimeout(2500)
  await tall.screenshot({ path: join(OUT, `page-${p}.png`), fullPage: true })
  await tall.close()
}
await browser.close()
