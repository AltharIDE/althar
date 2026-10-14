// Shoots the live page, headless, while its server runs: node prototypes/ready-blockers/shoot.mjs [letter]
// from apps/desktop, outside the sandbox (Chromium can't start in it). Then checks that switching works in place.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5371'
const OUT = join(import.meta.dirname, 'shots')
mkdirSync(OUT, { recursive: true })

const only = process.argv[2]?.toUpperCase()
const LETTERS = ['T', 'A', 'B', 'C', 'D', 'E']
/** Each screen, its number in the shot's name, and the window it is shot in: the board tall enough for its seven ready cards. */
const SCREENS = [
  { s: 'states', n: 1, height: null },
  { s: 'board', n: 2, height: 1500 },
  { s: 'home', n: 3, height: 1000 },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
let errors = 0
page.on('console', (m) => m.type() === 'error' && (errors++, console.error('  console:', m.text().slice(0, 400))))
page.on('pageerror', (e) => (errors++, console.error('  pageerror:', e.message.slice(0, 400))))

const settle = async () => {
  await page.mouse.move(0, 0)
  // The home reads its fake runtime, then each line arrives on its own.
  await page.waitForTimeout(2200)
}

for (const letter of LETTERS) {
  if (only !== undefined && only !== letter) continue
  for (const { s, n, height } of SCREENS) {
    await page.setViewportSize({ width: 1600, height: height ?? 1000 })
    await page.goto(`${BASE}/?d=${letter}&s=${s}`)
    await page.waitForSelector('main > *')
    await settle()
    if (height === null) {
      // Every state, whole: the window as tall as the sheet and the bar.
      const whole = await page.evaluate(
        () => (document.querySelector('main')?.scrollHeight ?? 0) + (document.querySelector('nav')?.offsetHeight ?? 0),
      )
      await page.setViewportSize({ width: 1600, height: whole })
      await page.waitForTimeout(300)
    }
    const name = `${letter}${n}-${s}`
    await page.screenshot({ path: join(OUT, `${name}.png`) })
    console.error(name)
  }
}

if (only === undefined || only === 'X') {
  await page.setViewportSize({ width: 1800, height: 1100 })
  await page.goto(`${BASE}/compare.html`)
  await page.waitForSelector('[data-shot]')
  await settle()
  await page.locator('[data-shot="X1"]').screenshot({ path: join(OUT, 'X1-compare.png') })
  console.error('X1-compare')
}

// Switching (or alone: … shoot.mjs switch): keys and the bar change the direction and the URL in place; the home's lines
// stay the same lines, not read again.
if (only === undefined || only === 'SWITCH') {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${BASE}/?d=A&s=home`)
  await settle()
  const line = page.getByRole('article').filter({ hasText: 'Let a lead ask Althar to push its new commits' })
  const before = await line.elementHandle()
  const said = async () => ({ url: new URL(page.url()).search, kind: await line.locator('span').first().textContent() })
  const steps = []
  steps.push(['start', await said()])
  await page.keyboard.press('3')
  steps.push(['key 3', await said()])
  await page.keyboard.press('ArrowRight')
  steps.push(['→', await said()])
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  steps.push(['← ←', await said()])
  await page.getByRole('radio', { name: /E · Card’s word/ }).click()
  await page.mouse.move(0, 0)
  steps.push(['click E', await said()])
  const same = await before?.evaluate((node) => node.isConnected)
  // Off the bar's choices, whose arrows and keys are their own.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.keyboard.press('b')
  steps.push(['key b', { url: new URL(page.url()).search, kind: '(the board)' }])
  for (const [step, { url, kind }] of steps) console.error(`  ${step.padEnd(8)} ${url.padEnd(16)} ${kind}`)
  console.error(`  the home's line is the same node after switching: ${same === true ? 'yes' : 'no (it was drawn again)'}`)
}

await browser.close()
console.error(errors === 0 ? 'no errors' : `${errors} errors`)
