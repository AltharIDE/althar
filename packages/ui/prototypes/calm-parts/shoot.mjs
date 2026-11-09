// Scrappy: the screenshots, headless at 1×, into test-results/calm-parts: node shoot.mjs [id…]  (outside the sandbox)
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const TITLE = 'Hold the board still while agents work'
const card = (title = TITLE) => ({ selector: `article:has-text("${title}")` })
/** Around what it shows in the thread: from `before` px over it to `after` under it. */
const around = (text, before = 160, after = 260) => ({ around: { text, before, after } })
const top = (height) => ({ clip: { x: 0, y: 44, width: 1440, height } })

/** Each shot: its id (ordered), the direction, the case, where, what to press first, what to take. */
export const SHOTS = [
  // A · As one, chosen (9 November). The task's pill: the changes' marks inside it, one sentence, one button; the marks open to each change.
  { id: '01-A-needs-one-bar', d: 'A', s: 'needs-one', at: 'task', ...top(56) },
  { id: '02-A-needs-one-marks', d: 'A', s: 'needs-one', at: 'task', press: 'button[aria-label^="3 changes"]', pop: true },
  { id: '03-A-siblings-bar', d: 'A', s: 'siblings', at: 'task', ...top(56) },
  { id: '04-A-stack-bar', d: 'A', s: 'stack', at: 'task', ...top(56) },
  // The board card: the same sentence, less what its status already says, the marks and a count at its foot
  { id: '05-A-needs-one-card', d: 'A', s: 'needs-one', at: 'board', ...card() },
  { id: '06-A-stack-held-card', d: 'A', s: 'stack-held', at: 'board', ...card() },
  { id: '07-A-after-merge-card', d: 'A', s: 'after-merge', at: 'board', ...card('Rename “Keep for later” to “Later”') },
  // The thread: a step in the work stamped, Shipped and Merged in green, a new change in cobalt
  { id: '08-A-release-on-thread', d: 'A', s: 'release-on', at: 'task', ...around('took main in', 200, 60) },
  { id: '09-A-split-thread', d: 'A', s: 'split', at: 'task', ...around('Keep them together', 60, 60) },
  { id: '10-A-merged-one-thread', d: 'A', s: 'merged-one', at: 'task', ...around('Rename and Card slide carry on', 40, 200) },
  // Outputs: each change a line that opens and folds; the one the task's fact is about starts open, a settled one folded
  { id: '11-outputs-needs-one', d: 'A', s: 'needs-one', at: 'task', face: 'out', clip: { x: 0, y: 44, width: 1440, height: 760 } },
  { id: '12-outputs-merged-folded', d: 'A', s: 'merged-one', at: 'task', face: 'out', clip: { x: 0, y: 44, width: 1440, height: 420 } },
  {
    id: '13-outputs-merged-opened',
    d: 'A',
    s: 'merged-one',
    at: 'task',
    face: 'out',
    press: 'section[aria-label="Lane heights"] button[aria-expanded]',
    clip: { x: 0, y: 44, width: 1440, height: 560 },
  },
  // The plan card: its preset, a quiet word in its kicker
  { id: '14-plan-preset-word', d: 'A', s: 'needs-one', at: 'talk', selector: '[class*="TaskLaunch-module__launch"]' },
  { id: '15-plan-preset-open', d: 'A', s: 'needs-one', at: 'talk', press: 'button[aria-label^="Preset"]', pop: true },
  // Your two flows: a release with main red, fixed first; two tickets on two branches, kept together.
  { id: '16-A-release-red-bar', d: 'A', s: 'release-red', at: 'task', ...top(56) },
  { id: '17-A-release-red-marks', d: 'A', s: 'release-red', at: 'task', press: 'button[aria-label^="2 changes"]', pop: true },
  { id: '18-A-release-red-card', d: 'A', s: 'release-red', at: 'board', ...card('Cut 0.9.0') },
  { id: '19-A-tickets-split-thread', d: 'A', s: 'tickets-split', at: 'task', ...around('for DEV-141.', 200, 60) },
  { id: '20-A-tickets-one-parts', d: 'A', s: 'tickets-one', at: 'task', press: 'button[aria-label^="Parts,"]', pop: true },
  // The other two directions, kept on the page for comparison
  { id: '21-B-needs-one-switch', d: 'B', s: 'needs-one', at: 'task', press: 'button[aria-label^="Showing"]', pop: true },
  { id: '22-C-needs-one-tabs', d: 'C', s: 'needs-one', at: 'task', clip: { x: 280, y: 750, width: 880, height: 110 } },
]

const only = process.argv.slice(2)
const out = resolve(repo, 'test-results/calm-parts')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
for (const shot of SHOTS.filter((one) => only.length === 0 || only.some((id) => one.id.startsWith(id)))) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).split('\n')[0]))
  const where =
    shot.at === 'task'
      ? 'threads/th1'
      : shot.at === 'board'
        ? 'projects/p1?room=board'
        : shot.at === 'talk'
          ? 'projects/p1?room=talk'
          : 'projects/p1'
  const extra = `${shot.open === undefined ? '' : `&open=${shot.open}`}${shot.face === undefined ? '' : `&face=${shot.face}`}`
  await page.goto(`http://localhost:5374/?d=${shot.d}&s=${shot.s}&bare${extra}#/${where}`)
  await page.waitForTimeout(1400)
  if (shot.press !== undefined) {
    await page.locator(shot.press).first().click()
    await page.waitForTimeout(500)
  }
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
  const path = resolve(out, `${shot.id}.png`)
  if (shot.pop === true) {
    // What the press opened, with what it hangs from: the menu or popover's box, widened and taken from the bar down.
    const box = await page
      .locator('[role=dialog], [role=menu]')
      .last()
      .boundingBox({ timeout: 3000 })
      .catch(() => null)
    const x = Math.max(0, Math.round((box?.x ?? 600) - 120))
    const bottom = Math.round((box?.y ?? 300) + (box?.height ?? 300) + 16)
    const y = Math.max(0, Math.round((box?.y ?? 100) - 110))
    await page.screenshot({
      path,
      clip: { x, y, width: Math.min(1440 - x, Math.round((box?.width ?? 400) + 240)), height: Math.min(900 - y, bottom - y) },
    })
  } else if (shot.around !== undefined) {
    const found = page.locator(`text=${shot.around.text}`).last()
    await found.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined)
    await page.waitForTimeout(200)
    const box = await found.boundingBox({ timeout: 5000 }).catch(() => null)
    const y = Math.max(0, Math.round((box?.y ?? 400) - shot.around.before))
    await page.screenshot({ path, clip: { x: 280, y, width: 880, height: Math.min(900 - y, shot.around.before + shot.around.after) } })
  } else if (shot.selector !== undefined) await page.locator(shot.selector).first().screenshot({ path })
  else await page.screenshot({ path, clip: shot.clip })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
await browser.close()
