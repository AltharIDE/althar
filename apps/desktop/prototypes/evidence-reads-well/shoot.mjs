// Shoots the prototype's windows, headless: node prototypes/evidence-reads-well/shoot.mjs [only-prefix ...]. Run outside the sandbox.
// Each window is shot whole: tall enough that its thread or Outputs shows without scrolling.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5361'
const OUT = join(import.meta.dirname, '../../test-results/evidence-reads-well')
mkdirSync(OUT, { recursive: true })

const scenarios = ['ui', 'runtime', 'unverified', 'none']
const shots = ['today', 'a', 'b', 'c', 'd', 'e'].flatMap((d) => [
  ...scenarios.flatMap((s, i) => [
    [`${d === 'today' ? 'T' : d.toUpperCase()}${i * 2 + 1}`, `d=${d}&s=${s}&f=thread`],
    [`${d === 'today' ? 'T' : d.toUpperCase()}${i * 2 + 2}`, `d=${d}&s=${s}&f=out`],
  ]),
  ...(d === 'd' ? [['D9', 'd=d&s=ui&f=thread&open']] : []),
])
const only = process.argv.slice(2)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 })
page.on('console', (m) => m.type() === 'error' && console.error('  console:', m.text().slice(0, 300)))
page.on('pageerror', (e) => console.error('  pageerror:', e.message.slice(0, 300)))
for (const [name, query] of shots) {
  if (only.length > 0 && !only.some((p) => name.startsWith(p))) continue
  await page.setViewportSize({ width: 1180, height: 900 })
  await page.goto(`${BASE}/screen.html?${query}`)
  await page.waitForSelector('#root > *')
  await page.waitForTimeout(900)
  // The scroller with the most to show sets the window's height.
  const more = await page.evaluate(() => {
    let most = 0
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      if (!/(auto|scroll)/.test(style.overflowY)) continue
      most = Math.max(most, el.scrollHeight - el.clientHeight)
    }
    return most
  })
  await page.setViewportSize({ width: 1180, height: Math.min(900 + more + 40, 7000) })
  await page.waitForTimeout(700)
  // Scrolled to the top: the step's report and its evidence, not the end of the thread.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0
  })
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => (img.complete ? Promise.resolve() : new Promise((r) => (img.onload = img.onerror = r))))),
  )
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.error(name, 900 + more)
}
await browser.close()
