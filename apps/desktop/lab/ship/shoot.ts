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
} else if (mode === 'two') {
  // The button alone in each two-line look, at three routes, on one sheet.
  const looks: Array<[string, string]> = [
    ['twoLine', 'Dots'],
    ['twoArrows', 'Arrows'],
    ['twoChevrons', 'Chevrons'],
    ['twoIcons', 'Icons'],
    ['twoAll', 'Every stop, skipped ones faded'],
    ['twoPills', 'Pills'],
    ['side', 'Route beside Ship'],
  ]
  const routes: Array<[string, string]> = [
    ['review-ready', 'Review, push, ready'],
    ['review-merge', 'Review to merged'],
    ['push-merge', 'No review, merged'],
  ]
  const cells: string[] = []
  for (const [look, name] of looks) {
    const row: string[] = []
    for (const [route] of routes) {
      await open('b2', 'held', `&look=${look}&explained=1&route=${route}`)
      const group = page.locator('[data-lab-scene] article [role="group"]:has(button[aria-label="How far it goes"])').first()
      const box = await group.boundingBox()
      if (box === null) continue
      const shot = await page.screenshot({ clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } })
      row.push(`<img src="data:image/png;base64,${shot.toString('base64')}">`)
    }
    cells.push(`<div class="name">${name}</div>${row.join('')}`)
  }
  await page.setContent(`<!doctype html><style>
    body{margin:0;padding:16px;font:12px Inter,system-ui;background:#f6f5f1;color:#26231e}
    .g{display:grid;grid-template-columns:150px repeat(3,auto);gap:10px 14px;align-items:center;width:max-content}
    .h{color:#8a8478}.name{font-weight:600}img{display:block;border-radius:6px;background:#fff}
  </style><div class="g"><div></div>${routes.map(([, r]) => `<div class="h">${r}</div>`).join('')}${cells.join('')}</div>`)
  await page.locator('.g').screenshot({ path: join(out, 'two-sheet.png') })
  process.stdout.write('two-sheet.png\n')

  // The same button as Ship runs, review to merged in a project of one.
  const along: Array<[string, string]> = [
    ['held', 'Before'],
    ['reviewing', 'Reviewing'],
    ['pushing', 'Pushing'],
    ['readyChecks', 'Checks'],
  ]
  const rows: string[] = []
  for (const [look, name] of looks.filter(([one]) => ['twoArrows', 'twoIcons', 'twoPills', 'side'].includes(one))) {
    const row: string[] = []
    for (const [m] of along) {
      await open('b2', m, `&look=${look}&explained=1&route=review-merge&solo=1`)
      const box = await page
        .locator('[data-lab-scene] article [role="group"]:has(button[aria-label="How far it goes"])')
        .first()
        .boundingBox()
      if (box === null) continue
      const shot = await page.screenshot({ clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } })
      row.push(`<img src="data:image/png;base64,${shot.toString('base64')}">`)
    }
    rows.push(`<div class="name">${name}</div>${row.join('')}`)
  }
  await page.setContent(`<!doctype html><style>
    body{margin:0;padding:16px;font:12px Inter,system-ui;background:#f6f5f1;color:#26231e}
    .g{display:grid;grid-template-columns:120px repeat(4,auto);gap:10px 14px;align-items:center;width:max-content}
    .h{color:#8a8478}.name{font-weight:600}img{display:block;border-radius:6px;background:#fff}
  </style><div class="g"><div></div>${along.map(([, a]) => `<div class="h">${a}</div>`).join('')}${rows.join('')}</div>`)
  await page.locator('.g').screenshot({ path: join(out, 'two-running.png') })
  process.stdout.write('two-running.png\n')
} else if (mode === 'intros') {
  // Every stop, and each way Ship explains itself the first time; the press after it was pressed, the link opened.
  const shots: Array<[string, string, string]> = [
    ['legend', '', ''],
    ['press', '', ''],
    ['press', '&pressed=1', 'pressed'],
    ['pointer', '', ''],
    ['link', '', ''],
    ['link', '', 'open'],
    ['legend', '&solo=1&route=push-merge', 'nr'],
  ]
  for (const [intro, extra, what] of shots) {
    await open('b2', 'held', `&look=twoAll&intro=${intro}${extra}`)
    if (what === 'open') {
      await page.click('[data-lab-scene] button:has-text("How Ship works")')
      await page.waitForTimeout(400)
    }
    const bottom = await page.evaluate((title) => {
      const card = document.querySelector(`[data-lab-scene] article[aria-label="${title}"]`)
      const files = card?.querySelector('[class*="files"]')
      const over = [...document.querySelectorAll('[role="note"], [data-radix-popper-content-wrapper]')].map(
        (one) => one.getBoundingClientRect().bottom,
      )
      return Math.max(files?.getBoundingClientRect().top ?? 400, ...over)
    }, TITLE)
    const file = `intro-${intro}${what === '' ? '' : `-${what}`}.png`
    await page.screenshot({ path: join(out, file), clip: { x: 610, y: 52, width: 646, height: Math.min(748, bottom - 52 + 14) } })
    process.stdout.write(`${file}\n`)
  }
} else if (mode === 'guides') {
  // Each variant of the friendly modal, the ones you edit in after a press or two, and Ship's button once one closes.
  const dialog = async (file: string) => {
    // The ring the dialog's first focus draws when opened from an address, not a click.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.waitForTimeout(250)
    const box = await page.locator('[role="dialog"]').boundingBox()
    if (box === null) throw new Error(`no dialog for ${file}`)
    await page.screenshot({ path: join(out, file), clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } })
    process.stdout.write(`${file}\n`)
  }
  const shots: Array<[string, string, (() => Promise<void>) | null]> = [
    ['pathToggle', '', null],
    ['pathToggle', 'changing', () => page.click('[role="dialog"] [role="switch"][aria-label="Change stops"]')],
    [
      'pathToggle',
      'changed',
      async () => {
        await page.click('[role="dialog"] [role="switch"][aria-label="Change stops"]')
        await page.click('[role="dialog"] [role="switch"][aria-label="Review"]')
      },
    ],
    ['switches', '', null],
    [
      'switches',
      'edited',
      async () => {
        await page.click('[role="dialog"] [role="switch"][aria-label="Review"]')
        await page.click('[role="dialog"] [role="switch"][aria-label="Ready"]')
      },
    ],
    ['tap', '', null],
    ['tap', 'edited', () => page.click('[role="dialog"] button[aria-pressed]:has-text("Review")')],
    ['pick', '', null],
    ['tour', '', null],
    ['tour', 'last', () => page.click('[role="dialog"] nav button:has-text("Merge")')],
    ['short', '', null],
    ['short', 'more', () => page.click('[role="dialog"] button:has-text("What each stop does")')],
  ]
  for (const [guide, what, act] of shots) {
    await open('b2', 'held', `&look=twoAll&intro=modal&explained=1&modal=1&guide=${guide}`)
    await page.waitForSelector('[role="dialog"]')
    if (act !== null) await act()
    await dialog(`guide-${guide}${what === '' ? '' : `-${what}`}.png`)
  }
  // Closed after the edit: Ship's button has followed it.
  await page.click('[role="dialog"] button:has-text("Close")').catch(() => undefined)
  await open('b2', 'held', '&look=twoAll&intro=modal&explained=1&modal=1&guide=switches')
  await page.click('[role="dialog"] [role="switch"][aria-label="Review"]')
  await page.click('[role="dialog"] button:has-text("Close")')
  await page.waitForTimeout(300)
  const group = await page
    .locator('[data-lab-scene] article [role="group"]:has(button[aria-label="How far it goes"])')
    .first()
    .boundingBox()
  if (group !== null)
    await page.screenshot({
      path: join(out, 'guide-after.png'),
      clip: { x: group.x - 12, y: group.y - 12, width: group.width + 24, height: group.height + 56 },
    })
  process.stdout.write('guide-after.png\n')
} else if (mode === 'modal') {
  // The quiet link under Ship, the friendly modal it opens (on two routes), and, hidden, the arrow's menu that keeps it.
  const cardTo = async (file: string) => {
    const bottom = await page.evaluate((title) => {
      const card = document.querySelector(`[data-lab-scene] article[aria-label="${title}"]`)
      const files = card?.querySelector('[class*="files"]')
      const over = [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].map((one) => one.getBoundingClientRect().bottom)
      return Math.max(files?.getBoundingClientRect().top ?? 400, ...over)
    }, TITLE)
    await page.screenshot({ path: join(out, file), clip: { x: 610, y: 52, width: 646, height: Math.min(748, bottom - 52 + 14) } })
    process.stdout.write(`${file}\n`)
  }
  await open('b2', 'held', '&look=twoAll&intro=modal')
  await cardTo('modal-link.png')
  const opened: Array<[string, string]> = [
    ['', 'modal-open.png'],
    ['&solo=1&route=push-merge', 'modal-open-nr.png'],
  ]
  for (const [extra, file] of opened) {
    await open('b2', 'held', `&look=twoAll&intro=modal&modal=1${extra}`)
    await page.waitForSelector('[role="dialog"]')
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(out, file) })
    process.stdout.write(`${file}\n`)
  }
  await open('b2', 'held', '&look=twoAll&intro=modal&hidden=1&explained=1')
  await page.click('[data-lab-scene] button[aria-label="How far it goes"]')
  await page.waitForTimeout(400)
  await cardTo('modal-hidden-menu.png')
} else {
  const [d = 'a', m = 'readyChecks', narrow] = rest
  await open(d, m, narrow === 'narrow' ? '&narrow=1' : '')
  const file = `whole-${d}-${m}${narrow === 'narrow' ? '-narrow' : ''}.png`
  await page.screenshot({ path: join(out, file) })
  process.stdout.write(`${file}\n`)
}
await browser.close()
