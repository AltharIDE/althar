/*
 * Shoots the graph lab headless at 1×, into lab/graph/shots (git ignores
 * it), with the lab running on 6171. Chromium can't start in an agent's
 * sandbox on a Mac; run it outside.
 *
 *   node lab/graph/shoot.ts stills            # every direction at a moment worth seeing, 2, 6 and 12 tasks, narrow too
 *   node lab/graph/shoot.ts frames A six      # a frame each 1.5 minutes of work, as the request plays out, for a recording
 *
 * A recording from its frames: ffmpeg (see README.md).
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const LAB = 'http://localhost:6171'
const [what = 'stills', ...rest] = process.argv.slice(2)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

const settle = (ms = 700) => page.waitForTimeout(ms)
const go = async (query: string, hash = '') => {
  await page.goto(`${LAB}/?${query}${hash}`)
  await page.waitForSelector('[data-lab-bar]')
  await settle(1200)
}
const shot = async (name: string, at: Page = page) => {
  await at.screenshot({ path: join(out, `${name}.png`) })
  process.stdout.write(`${name}\n`)
}
/** Points at an element, then away from the bar, so its popover or its line shows. */
const point = async (selector: string) => {
  await page.hover(selector)
  await settle(900)
}

if (what === 'stills') {
  // A · In the conversation.
  await go('d=A&s=six&t=30&paused=1')
  await shot('a-six')
  await point('[data-node="receipts"] button')
  await shot('a-six-detail')
  await go('d=A&s=twelve&t=48&paused=1')
  await shot('a-twelve')
  await go('d=A&s=two&t=14&paused=1')
  await shot('a-two')
  await go('d=A&s=six&t=30&paused=1&narrow=1')
  await shot('a-six-narrow')

  // B · Over the board.
  await go('d=B&s=six&t=30&paused=1')
  await point('[data-node="api"] button')
  await shot('b-six')
  await go('d=B&s=twelve&t=48&paused=1')
  await shot('b-twelve')
  await go('d=B&s=six&t=30&paused=1&narrow=1')
  await shot('b-six-narrow')

  // C · On a task's page.
  await go('d=C&s=six&t=30&paused=1&face=request', '#/threads/th_six-api')
  await shot('c-six')
  await go('d=C&s=twelve&t=48&paused=1&face=request', '#/threads/th_twelve-invoices')
  await shot('c-twelve')
  await go('d=C&s=six&t=30&paused=1&face=request&narrow=1', '#/threads/th_six-receipts')
  await shot('c-six-narrow')

  // D · Lines on the board.
  await go('d=D&s=six&t=30&paused=1')
  await shot('d-six-rest')
  await point('[data-lane] [data-move="t_six-api"]')
  await shot('d-six')
  await go('d=D&s=twelve&t=48&paused=1')
  await point('[data-lane] [data-move="t_twelve-charges"]')
  await shot('d-twelve')
} else if (what === 'frames') {
  const [d = 'A', s = 'six', every = '1.5'] = rest
  const dir = join(out, `frames-${d.toLowerCase()}-${s}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  await go(`d=${d}&s=${s}&t=0&paused=1`)
  const end: number = await page.evaluate(() => {
    const lab = (window as unknown as { graphLab: { clock: { set: (t: number) => void } } }).graphLab
    lab.clock.set(0)
    return 0
  })
  void end
  let n = 0
  for (let t = 0; t <= 110; t += Number(every)) {
    await page.evaluate((at) => {
      const lab = (window as unknown as { graphLab: { clock: { set: (t: number) => void } } }).graphLab
      lab.clock.set(at)
    }, t)
    await settle(480)
    await page.screenshot({ path: join(dir, `${String(n).padStart(3, '0')}.png`) })
    n += 1
  }
  process.stdout.write(`${n} frames in ${dir}\n`)
}

await browser.close()
