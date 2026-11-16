/*
 * Shoots the blockers lab headless at 1×, into lab/blockers/shots (git ignores
 * it), with the lab running (on 6174, or LAB_PORT). Chromium can't start in
 * an agent's sandbox on a Mac; run it outside.
 *
 *   node lab/blockers/shoot.ts <name> '<query>' [steps…]
 *
 * The query is the lab's own (README.md): `d=B&t=26&paused=1`.
 * Each step after it is done in order before the picture:
 *
 *   hash=#/threads/th_pair            go to a place in the app
 *   scroll=<selector>                 bring something into view, at the middle of what scrolls it
 *   hover=<selector>                  point at something, and wait for what it opens
 *   click=<selector>                  press something
 *   type=<text>                       type into what has focus, then press Return
 *   key=<key>                         press a key (Escape, r, …)
 *   wait=<ms>                         wait
 *   crop=<x>,<y>,<w>,<h>              take only that part of the window
 *   frames=<from>,<to>,<step>         a picture each `step` minutes of work from `from` to `to`, into shots/<name>/, for a recording
 *
 * The window is 1440×900, or 880 wide where the query has narrow=1.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const LAB = `http://localhost:${process.env.LAB_PORT ?? 6174}`
const [name, query = '', ...steps] = process.argv.slice(2)
if (name === undefined) throw new Error('shoot.ts <name> <query> [steps…]')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const settle = (ms = 700) => page.waitForTimeout(ms)

const hash = steps.find((one) => one.startsWith('hash='))?.slice(5) ?? ''
await page.goto(`${LAB}/?${query}${hash}`)
await page.waitForSelector('[data-lab-bar]')
await settle(1400)

let clip: { x: number; y: number; width: number; height: number } | undefined
for (const step of steps) {
  const [what, ...rest] = step.split('=')
  const value = rest.join('=')
  if (what === 'scroll') {
    await page
      .locator(value)
      .first()
      .evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await settle(500)
  } else if (what === 'hover') {
    await page.hover(value)
    await settle(900)
  } else if (what === 'click') {
    await page.click(value)
    await settle(700)
  } else if (what === 'type') {
    await page.keyboard.type(value)
    await page.keyboard.press('Enter')
    await settle(2200)
  } else if (what === 'key') {
    await page.keyboard.press(value)
    await settle(500)
  } else if (what === 'wait') await settle(Number(value))
  else if (what === 'crop') {
    const [x = 0, y = 0, width = 1440, height = 900] = value.split(',').map(Number)
    clip = { x, y, width, height }
  } else if (what === 'frames') {
    const [from = 0, to = 60, by = 1.5] = value.split(',').map(Number)
    const dir = join(out, name)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    let n = 0
    for (let t = from; t <= to + 1e-9; t += by) {
      await page.evaluate((minute) => {
        const lab = (window as unknown as { blockersLab: { clock: { set: (t: number) => void } } }).blockersLab
        lab.clock.set(minute)
      }, t)
      await settle(260)
      n += 1
      await page.screenshot({ path: join(dir, `${String(n).padStart(3, '0')}.png`), ...(clip === undefined ? {} : { clip }) })
    }
    process.stdout.write(`${n} frames in ${dir}\n`)
  }
}
if (!steps.some((one) => one.startsWith('frames='))) {
  await page.screenshot({ path: join(out, `${name}.png`), ...(clip === undefined ? {} : { clip }) })
  process.stdout.write(`${join(out, `${name}.png`)}\n`)
}
await browser.close()
