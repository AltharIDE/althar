// Scrappy: the app's narrowest window (880 wide, main.ts minWidth), the strip visible: says where anything overflows, and takes the
// crowded cases. node narrow.mjs [shoot]   (outside the sandbox: Chromium can't start in it)
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const width = 880
const height = 700
const keys = readFileSync(resolve(import.meta.dirname, 'cases.ts'), 'utf8')
  .match(/key: '([a-z-]+)'/g)
  .map((one) => one.slice(6, -1))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error).split('\n')[0]))

const go = async (url) => {
  for (let tries = 0; tries < 3; tries += 1) {
    try {
      await page.goto(url)
      return
    } catch {
      await page.waitForTimeout(400)
    }
  }
  await page.goto(url)
}

// What overflows: the strip, the task's bar, anything wider than the window.
const measure = () =>
  page.evaluate((w) => {
    const bad = []
    const strip = document.querySelector('[class*="switcher"]')
    if (strip && strip.scrollWidth > strip.clientWidth + 1) bad.push(`strip ${strip.scrollWidth}>${strip.clientWidth}`)
    if (document.documentElement.scrollWidth > w) bad.push(`page ${document.documentElement.scrollWidth}>${w}`)
    const scrolls = (el) => {
      for (let up = el.parentElement; up !== null; up = up.parentElement) {
        const x = getComputedStyle(up).overflowX
        if ((x === 'auto' || x === 'scroll') && up.scrollWidth > up.clientWidth) return true
      }
      return false
    }
    for (const el of document.querySelectorAll('header, header *, section[aria-label] *, article *')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== 'fixed' && !scrolls(el))
        bad.push(
          `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)} “${(el.textContent ?? '').trim().slice(0, 30)}”`,
        )
    }
    return [...new Set(bad)].slice(0, 4)
  }, width)

let wide = 0
for (const key of keys) {
  for (const d of ['A', 'B', 'C']) {
    for (const where of ['threads/th1', 'projects/p1?room=board']) {
      await go(`http://localhost:5374/?d=${d}&s=${key}#/${where}`)
      await page.waitForTimeout(500)
      const bad = await measure()
      if (bad.length > 0) {
        wide += 1
        process.stdout.write(`${key} ${d} ${where.startsWith('threads') ? 'task ' : 'board'}  ${bad.join(' | ')}\n`)
      }
    }
  }
}
process.stdout.write(
  `${wide} loads overflow at ${width}px; page errors: ${errors.length === 0 ? 'none' : [...new Set(errors)].join(' | ')}\n`,
)

if (process.argv[2] === 'shoot') {
  const out = resolve(repo, 'test-results/calm-parts')
  mkdirSync(out, { recursive: true })
  const shots = [
    ['40-narrow-A-needs-one', 'A', 'needs-one', 'threads/th1', null],
    ['41-narrow-B-stack-held', 'B', 'stack-held', 'threads/th1', 'motion'],
    ['42-narrow-C-held-beside', 'C', 'held-beside', 'threads/th1', 'outbox'],
    ['43-narrow-A-board', 'A', 'needs-one', 'projects/p1?room=board', null],
  ]
  for (const [id, d, s, where, open] of shots) {
    await go(`http://localhost:5374/?d=${d}&s=${s}${open === null ? '' : `&open=${open}`}#/${where}`)
    await page.waitForTimeout(1400)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: resolve(out, `${id}.png`) })
    process.stdout.write(`${id}\n`)
  }
}
await browser.close()
