import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the drafting lab (README.md), headless, at 1×, into lab/drafting/shots: C while it assembles, then each of the
 * three ways it becomes the plan as frames through the hand-over, and C2 as the plan, narrow and three at once. With the
 * lab running on port 6133; outside an agent's sandbox.
 *
 *   node lab/drafting/shoot.ts
 */

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 820, height: 560 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => console.error('page error:', error.message))
const say = (line: string) => process.stdout.write(`${line}\n`)

const shoot = async (name: string, query: string, height = 560, width = 820) => {
  await page.setViewportSize({ width, height })
  await page.goto(`http://localhost:6133/?${query}`)
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, `${name}.png`) })
  say(name)
}

/** The hand-over, played at real pace from a moment before the plan arrives: a frame every `every` ms. */
const frames = async (name: string, d: string, count = 8, every = 90) => {
  await page.setViewportSize({ width: 820, height: 560 })
  await page.goto(`http://localhost:6133/?d=${d}&speed=1&from=26900`)
  await page.waitForFunction(() => document.querySelector('[data-ready="true"]') !== null, undefined, { polling: 10 })
  for (let at = 0; at < count; at++) {
    await page.screenshot({ path: join(out, `${name}-${at}.png`), clip: { x: 0, y: 90, width: 820, height: 330 } })
    await page.waitForTimeout(every)
  }
  say(`${name}: ${count} frames`)
}

await shoot('c-assembling', 'd=2&at=20000')
await frames('h1-swap', '1')
await frames('h2-morph', '2')
await frames('h3-one', '3')
await shoot('c2-plan', 'd=3&at=29000')
await shoot('c2-narrow', 'd=3&narrow=1&at=29000', 560, 640)
await shoot('c2-three', 'd=3&three=1&at=44000', 820)
/** The hand-over as a video, from a few moments before the plan arrives, at real pace. */
const record = async (name: string, d: string) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 480 },
    recordVideo: { dir: out, size: { width: 820, height: 480 } },
  })
  const one = await context.newPage()
  await one.goto(`http://localhost:6133/?d=${d}&speed=1&from=25500`)
  await one.waitForTimeout(4200)
  await context.close()
  await one.video()?.saveAs(join(out, `${name}.webm`))
  say(`${name}.webm`)
}
await record('v-morph', '2')
await record('v-one', '3')
await browser.close()
