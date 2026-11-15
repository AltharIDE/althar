import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the ship lab (README.md), headless, at 1×, into lab/ship/shots (git leaves it alone), with the lab running:
 *
 *   node lab/ship/shoot.ts cards     each direction at each moment: the task's header and its Change card, hovers open
 *   node lab/ship/shoot.ts whole <direction> <moment> [narrow]   the whole window
 *
 * cards also writes shots/cards.json: each picture with its direction and moment, in order.
 */

const [mode = 'cards', ...rest] = process.argv.slice(2)
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const port = process.env.LAB_PORT ?? '6133'
const TITLE = 'Enter waits for a running voice note before sending'
const DIRECTIONS = ['today', 'a', 'b', 'c']
const MOMENTS = [
  'held',
  'reviewing',
  'settling',
  'pushing',
  'draftChecks',
  'draftPassed',
  'readyChecks',
  'requiredPassed',
  'mergeable',
  'queued',
  'merged',
  'failed',
  'queueRefused',
  'heldPush',
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => console.error('page error:', error.message))

const open = async (d: string, m: string, extra = '') => {
  await page.goto(`http://localhost:${port}/?d=${d}&m=${m}&hover=1${extra}`)
  await page.waitForSelector('[data-lab-scene] [role="radio"][aria-checked="true"]:has-text("Outputs")')
  await page.waitForSelector(`[data-lab-scene] article[aria-label="${TITLE}"]`)
  await page.waitForTimeout(500)
}

if (mode === 'cards') {
  const shots: Array<{ direction: string; moment: string; file: string }> = []
  for (const m of MOMENTS)
    for (const d of DIRECTIONS) {
      await open(d, m)
      // The header's right half and the card down to its files, with any hover that is open under it.
      const box = await page.evaluate((title) => {
        const card = document.querySelector(`[data-lab-scene] article[aria-label="${title}"]`)
        if (card === null) return null
        const files = card.querySelector('[class*="files"]')
        const top = card.getBoundingClientRect()
        const cut = files === null ? top.bottom : files.getBoundingClientRect().top
        const hovers = [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].map(
          (one) => one.getBoundingClientRect().bottom,
        )
        return { bottom: Math.max(cut, ...hovers) }
      }, TITLE)
      if (box === null) continue
      const file = `${String(MOMENTS.indexOf(m) + 1).padStart(2, '0')}-${m}-${d}.png`
      await page.screenshot({ path: join(out, file), clip: { x: 610, y: 52, width: 646, height: Math.min(748, box.bottom - 52 + 14) } })
      shots.push({ direction: d, moment: m, file })
      process.stdout.write(`${file}\n`)
    }
  writeFileSync(join(out, 'cards.json'), JSON.stringify(shots, null, 2))
} else if (mode === 'onto') {
  // B′ at the moments it changes, with its menu open where that is what to see.
  const crop = async (file: string) => {
    const bottom = await page.evaluate((title) => {
      const card = document.querySelector(`[data-lab-scene] article[aria-label="${title}"]`)
      const files = card?.querySelector('[class*="files"]')
      const open = [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].map((one) => one.getBoundingClientRect().bottom)
      return Math.max((files ?? card)?.getBoundingClientRect()[files ? 'top' : 'bottom'] ?? 400, ...open)
    }, TITLE)
    await page.screenshot({ path: join(out, file), clip: { x: 610, y: 52, width: 646, height: Math.min(748, bottom - 52 + 14) } })
    process.stdout.write(`${file}\n`)
  }
  const menu = async () => {
    await page.click('[data-lab-scene] button[aria-label="How far it goes"]')
    await page.waitForTimeout(400)
  }
  const shots: Array<[string, string, boolean]> = [
    ['held', '', false],
    ['held', '', true],
    ['held', '&solo=1', true],
    ['heldLater', '', false],
    ['reviewing', '', true],
    ['readyChecks', '', false],
    ['readyChecks', '&solo=1', false],
  ]
  for (const [m, extra, withMenu] of shots) {
    await open('b2', m, extra)
    if (withMenu) await menu()
    await crop(`onto-${m}${extra === '' ? '' : '-solo'}${withMenu ? '-menu' : ''}.png`)
  }
} else if (mode === 'looks') {
  // B′'s ways of saying Ship at its button: the first time, and once Got it was said; the track look as Ship runs too.
  const shots: Array<[string, string, string]> = []
  for (const look of ['caption', 'twoLine', 'track', 'coach', 'route']) {
    shots.push([look, 'held', ''], [look, 'held', '&explained=1'])
  }
  shots.push(['track', 'reviewing', '&explained=1'], ['track', 'readyChecks', '&explained=1&solo=1'])
  for (const [look, m, extra] of shots) {
    await open('b2', m, `&look=${look}${extra}`)
    const bottom = await page.evaluate((title) => {
      const card = document.querySelector(`[data-lab-scene] article[aria-label="${title}"]`)
      const files = card?.querySelector('[class*="files"]')
      const coach = document.querySelector('[role="note"]')
      return Math.max(files?.getBoundingClientRect().top ?? 400, coach?.getBoundingClientRect().bottom ?? 0)
    }, TITLE)
    const file = `look-${look}-${m}${extra.includes('explained') ? '-after' : ''}.png`
    await page.screenshot({ path: join(out, file), clip: { x: 610, y: 52, width: 646, height: Math.min(748, bottom - 52 + 14) } })
    process.stdout.write(`${file}\n`)
  }
} else {
  const [d = 'a', m = 'readyChecks', narrow] = rest
  await open(d, m, narrow === 'narrow' ? '&narrow=1' : '')
  const file = `whole-${d}-${m}${narrow === 'narrow' ? '-narrow' : ''}.png`
  await page.screenshot({ path: join(out, file) })
  process.stdout.write(`${file}\n`)
}
await browser.close()
