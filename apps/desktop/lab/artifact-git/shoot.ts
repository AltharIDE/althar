// Shoots each direction's moments, at 1×, the app's window only, into lab/artifact-git/shots (the lab running on 6207):
// node lab/artifact-git/shoot.ts [name-prefix…]. Chromium can't start in an agent's sandbox on a Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })

/** A press on a button or link by its words, or a wait. */
type Step = { click: string } | { wait: number }

interface Shot {
  readonly name: string
  readonly query: string
  readonly steps?: ReadonlyArray<Step>
  readonly width?: number
}

const SHOTS: ReadonlyArray<Shot> = [
  { name: 'a1-changed', query: 'd=a&m=1' },
  { name: 'a1-shown', query: 'd=a&m=1', steps: [{ click: 'Show' }] },
  { name: 'a2-together', query: 'd=a&m=2' },
  { name: 'a3-save', query: 'd=a&m=3' },
  { name: 'a3-saved', query: 'd=a&m=3', steps: [{ click: 'Commit v6' }, { wait: 1300 }] },
  { name: 'a4-ana', query: 'd=a&m=4' },
  { name: 'a4-ana-git', query: 'd=a&m=4', steps: [{ click: 'In git' }] },
  { name: 'b1-changed', query: 'd=b&m=1' },
  { name: 'b2-compare', query: 'd=b&m=2' },
  { name: 'b3-save', query: 'd=b&m=3' },
  { name: 'b4-ana-files', query: 'd=b&m=4' },
  { name: 'b4-ana-boards', query: 'd=b&m=4', steps: [{ click: 'Boards' }] },
  { name: 'c1-changed', query: 'd=c&m=1' },
  { name: 'c2-asks', query: 'd=c&m=2' },
  { name: 'c3-saved', query: 'd=c&m=3' },
  { name: 'c4-ana', query: 'd=c&m=4' },
  { name: 'd1-draft', query: 'd=d&m=1' },
  { name: 'd2-both', query: 'd=d&m=2' },
  { name: 'd3-hand-on', query: 'd=d&m=3' },
  { name: 'd4-ana', query: 'd=d&m=4' },
  { name: 'dark-b2-compare', query: 'd=b&m=2&theme=dark' },
  { name: 'dark-c2-asks', query: 'd=c&m=2&theme=dark' },
  { name: 'dark-d3-hand-on', query: 'd=d&m=3&theme=dark' },
  { name: 'narrow-b2-compare', query: 'd=b&m=2&narrow=1', width: 960 },
]

const only = process.argv.slice(2)

const run = async (page: Page, step: Step) => {
  if ('wait' in step) return page.waitForTimeout(step.wait)
  // Popovers open outside the window's element, in the page's own layer; the lab's bar has no button of these names.
  const target = page.getByRole('button', { name: step.click, exact: true })
  await target
    .or(page.getByRole('radio', { name: step.click, exact: true }))
    .first()
    .click()
  await page.waitForTimeout(500)
}

const browser = await chromium.launch()
for (const shot of SHOTS) {
  if (only.length > 0 && !only.some((prefix) => shot.name.startsWith(prefix))) continue
  const page = await browser.newPage({ viewport: { width: shot.width ?? 1280, height: 760 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6207/?${shot.query}`)
  await page.locator('[data-canvas-page]').waitFor()
  // The design's frames load, and an open popover grows in.
  await page.waitForTimeout(1200)
  for (const step of shot.steps ?? []) await run(page, step)
  await page.waitForTimeout(400)
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${shot.name}.png`) })
  await page.close()
}
await browser.close()
