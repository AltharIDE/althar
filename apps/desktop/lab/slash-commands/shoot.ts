// Shoots each direction through the same moments, at 1×, the app's window only, into lab/slash-commands/shots (the lab
// running on 6188): node lab/slash-commands/shoot.ts [direction…] [--only name…]. Chromium can't start in an agent's
// sandbox on a Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })

type Step = { type: string } | { press: string } | { wait: number }

interface Moment {
  readonly name: string
  readonly query: string
  readonly steps: ReadonlyArray<Step>
  readonly width?: number
}

const OBJECTIVE = 'Get e2e/onboarding.spec.ts passing on CI’s Linux run'

/** The same moments in each direction: finding it, the crowded list, picked, written, sent, a goal already set, and elsewhere. */
const moments = (d: string): ReadonlyArray<Moment> => [
  { name: '1-slash', query: `d=${d}`, steps: [{ type: '/' }] },
  { name: '2-more', query: `d=${d}&more=1`, steps: [{ type: '/' }] },
  { name: '3-picked', query: `d=${d}`, steps: [{ type: '/' }, { press: 'Enter' }] },
  { name: '4-written', query: `d=${d}`, steps: [{ type: '/' }, { press: 'Enter' }, { type: OBJECTIVE }] },
  { name: '5-sent', query: `d=${d}`, steps: [{ type: '/' }, { press: 'Enter' }, { type: OBJECTIVE }, { press: 'Enter' }, { wait: 1400 }] },
  { name: '6-set', query: `d=${d}&goal=active`, steps: [{ type: '/' }, { press: 'Enter' }] },
  { name: '7-paused-sent', query: `d=${d}&goal=active`, steps: [{ type: '/' }, { press: 'Enter' }, ...pause(d), { wait: 600 }] },
  { name: '8-dark', query: `d=${d}&goal=paused&theme=dark&more=1`, steps: [{ type: '/' }, { press: 'Enter' }] },
  { name: '9-coordinator', query: `d=${d}&place=coordinator&more=1`, steps: [{ type: '/' }] },
  {
    name: '11-aside',
    query: `d=${d}&place=aside`,
    steps: [{ type: '/' }, { press: 'Enter' }, { type: 'Keep the last board drawn until the read answers' }],
  },
  { name: '10-narrow', query: `d=${d}&goal=active&narrow=1&more=1`, steps: [{ type: '/go' }], width: 1000 },
]

/** Today's composer, for what changes: /goal is words until it is sent, and nothing of it lands in the thread. */
const today: ReadonlyArray<Moment> = [
  { name: '4-written', query: 'd=today', steps: [{ type: `/goal ${OBJECTIVE}` }] },
  { name: '5-sent', query: 'd=today', steps: [{ type: `/goal ${OBJECTIVE}` }, { press: 'Enter' }, { wait: 1400 }] },
]

/** Pausing a goal at work: B by its button, the rest by its word, picked from what /goal takes. */
const pause = (d: string): ReadonlyArray<Step> => (d === 'b' ? [{ press: 'click:Pause' }] : [{ type: 'p' }, { press: 'Enter' }])

const args = process.argv.slice(2)
const split = args.indexOf('--only')
const directions = (split === -1 ? args : args.slice(0, split)).filter(Boolean)
const only = split === -1 ? [] : args.slice(split + 1)
const shown = directions.length > 0 ? directions : ['a', 'b', 'c', 'd']

const run = async (page: Page, step: Step) => {
  if ('wait' in step) return page.waitForTimeout(step.wait)
  if ('type' in step) return page.keyboard.type(step.type, { delay: 12 })
  if (step.press.startsWith('click:'))
    return page
      .getByRole('button', { name: step.press.slice(6), exact: true })
      .first()
      .click()
  return page.keyboard.press(step.press)
}

const browser = await chromium.launch()
for (const d of shown)
  for (const moment of d === 'today' ? today : moments(d)) {
    if (only.length > 0 && !only.includes(moment.name)) continue
    const page = await browser.newPage({ viewport: { width: moment.width ?? 1180, height: 720 }, deviceScaleFactor: 1 })
    await page.goto(`http://localhost:6188/?${moment.query.includes('place=') ? '' : 'place=task&'}${moment.query}`)
    const field = page.locator('form textarea').first()
    await field.waitFor()
    await page.waitForTimeout(500)
    await field.click()
    for (const step of moment.steps) await run(page, step)
    await page.waitForTimeout(350)
    await page.locator('[data-lab-window]').screenshot({ path: join(out, `${d}-${moment.name}.png`) })
    await page.close()
  }
await browser.close()
