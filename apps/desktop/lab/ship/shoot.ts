import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots the ship lab (README.md), headless, at 1×, into lab/ship/shots (git leaves it alone), with the lab running:
 *
 *   node lab/ship/shoot.ts cards     each direction at each moment: the task's header and its Change card, hovers open
 *   node lab/ship/shoot.ts onto      B′ at the moments it changes
 *   node lab/ship/shoot.ts entries   each way into How Ship works, on the card
 *   node lab/ship/shoot.ts guide     How Ship works, as it opens, after a click on a stop, and from Ship's first press
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
} else if (mode === 'entries') {
  // Each way into How Ship works, on the Change card as the person meets it, opened where opening is what to see.
  const crop = async (file: string, below = 0) => {
    const bottom = await page.evaluate((title) => {
      const card = document.querySelector(`[data-lab-scene] article[aria-label="${title}"]`)
      const files = card?.querySelector('[class*="files"]')
      const over = [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].map((one) => one.getBoundingClientRect().bottom)
      return Math.max(files?.getBoundingClientRect().top ?? 400, ...over)
    }, TITLE)
    await page.screenshot({ path: join(out, file), clip: { x: 610, y: 52, width: 646, height: Math.min(748, bottom - 52 + 14 + below) } })
    process.stdout.write(`${file}\n`)
  }
  const ship = '[data-lab-scene] article [role="group"]:has(button[aria-label="How far it goes"])'
  const shots: Array<[string, string, (() => Promise<unknown>) | null, number]> = [
    ['words', '', null, 0],
    ['menu', '', null, 0],
    [
      'menu',
      'open',
      async () => {
        await page.click(`${ship} button[aria-label="How far it goes"]`)
        await page.waitForTimeout(400)
      },
      0,
    ],
    ['question', '', null, 0],
    [
      'hover',
      'open',
      async () => {
        await page.hover(`${ship} > button:first-child`)
        await page.waitForTimeout(900)
      },
      0,
    ],
    ['before', '', null, 0],
  ]
  for (const [entry, what, act, below] of shots) {
    await open('b2', 'held', `&entry=${entry}`)
    if (act !== null) await act()
    await crop(`entry-${entry}${what === '' ? '' : `-${what}`}.png`, below)
  }
} else if (mode === 'guide') {
  // The modal as it opens, after a click on Review's icon, and as Ship's first press opens it.
  const dialog = async (file: string) => {
    // The ring the dialog's first focus draws when opened from an address, not a click.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.waitForTimeout(250)
    const box = await page.locator('[role="dialog"]').boundingBox()
    if (box === null) throw new Error(`no dialog for ${file}`)
    await page.screenshot({ path: join(out, file), clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } })
    process.stdout.write(`${file}\n`)
  }
  await open('b2', 'held', '&entry=words&explained=1&modal=1')
  await page.waitForSelector('[role="dialog"]')
  await dialog('guide.png')
  await page.click('[role="dialog"] button[aria-label="Skip Review this time"]')
  await page.mouse.move(0, 0)
  await dialog('guide-changed.png')
  await open('b2', 'held', '&entry=firstPress')
  await page.click('[data-lab-scene] article [role="group"]:has(button[aria-label="How far it goes"]) > button:first-child')
  await page.waitForSelector('[role="dialog"]')
  await dialog('guide-first-press.png')
} else {
  const [d = 'a', m = 'readyChecks', narrow] = rest
  await open(d, m, narrow === 'narrow' ? '&narrow=1' : '')
  const file = `whole-${d}-${m}${narrow === 'narrow' ? '-narrow' : ''}.png`
  await page.screenshot({ path: join(out, file) })
  process.stdout.write(`${file}\n`)
}
await browser.close()
