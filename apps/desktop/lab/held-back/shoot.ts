import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

/*
 * Shoots the held-back lab (README.md), headless, at 1×, into lab/held-back/shots (git ignores it), with the lab running
 * (Held back lab, on port 6171). Chromium can't start in an agent's sandbox on a Mac; run it outside:
 *
 *   node lab/held-back/shoot.ts
 *
 * Each shot is a whole window: the board, or the task first in line, in a direction and a scene. `hover` points at a held
 * row first, so its line shows Start anyway; `open` opens a popover as the address says (tag, chip, mac).
 */

interface Shot {
  name: string
  d: string
  p?: string
  task?: boolean
  dark?: boolean
  narrow?: boolean
  open?: 'tag' | 'chip' | 'mac'
  hover?: string
  width?: number
  height?: number
}

const SHOTS: Shot[] = [
  { name: '01-as-built-board', d: '0' },
  { name: '02-as-built-task', d: '0', task: true, open: 'chip' },
  { name: '03-a-board', d: 'a', hover: 'worker' },
  { name: '04-a-task', d: 'a', task: true, open: 'chip' },
  { name: '05-a-crowded', d: 'a', p: 'crowded', height: 980 },
  { name: '06-b-board', d: 'b', hover: 'worker' },
  { name: '07-b-crowded', d: 'b', p: 'crowded', height: 980 },
  { name: '08-b-cpu-narrow', d: 'b', p: 'cpu', narrow: true, width: 1000 },
  { name: '09-c-board', d: 'c' },
  { name: '10-c-cpu', d: 'c', p: 'cpu' },
  { name: '11-d-board', d: 'd', open: 'tag' },
  { name: '12-d-cpu-narrow', d: 'd', p: 'cpu', narrow: true, width: 1000 },
  { name: '13-a-dark', d: 'a', dark: true, hover: 'worker' },
  { name: '14-b-dark', d: 'b', p: 'cpu', dark: true },
  { name: '15-c-dark', d: 'c', dark: true },
  { name: '16-d-dark', d: 'd', dark: true, open: 'tag' },
  { name: '17-a-task-dark', d: 'a', task: true, dark: true, open: 'chip' },
  { name: '18-b-calm', d: 'b', p: 'calm' },
  { name: '19-mac', d: 'a', open: 'mac' },
]

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6171'
const only = process.argv.slice(2)

const urlOf = (shot: Shot) => {
  const q = new URLSearchParams({ d: shot.d, p: shot.p ?? 'memory', still: '1', shot: '1' })
  if (shot.task === true) q.set('screen', 'task')
  if (shot.dark === true) q.set('theme', 'dark')
  if (shot.narrow === true) q.set('n', '1')
  if (shot.open !== undefined) q.set('open', shot.open)
  return `http://localhost:${port}/?${q.toString()}`
}

const browser = await chromium.launch()
const take = async (shot: Shot) => {
  const page: Page = await browser.newPage({ viewport: { width: shot.width ?? 1440, height: shot.height ?? 860 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.error(`${shot.name}: page error:`, error.message))
  await page.goto(urlOf(shot))
  await page.waitForSelector(shot.task === true ? 'textarea, [contenteditable="true"]' : 'section[data-lane="next"]')
  await page.waitForTimeout(500)
  if (shot.hover !== undefined) {
    await page.locator(`section[data-lane="next"] li[data-row="${shot.hover}"] article`).hover()
    await page.waitForTimeout(200)
  }
  await page.screenshot({ path: join(out, `${shot.name}.png`) })
  await page.close()
  process.stdout.write(`${shot.name}\n`)
}

for (const shot of SHOTS) if (only.length === 0 || only.some((one) => shot.name.includes(one))) await take(shot)
await browser.close()
