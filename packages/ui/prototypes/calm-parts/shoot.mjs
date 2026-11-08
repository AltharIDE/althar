// Scrappy: the screenshots, headless at 1×, into test-results/calm-parts: node shoot.mjs [id…]  (outside the sandbox)
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const TITLE = 'Hold the board still while agents work'
const card = (title = TITLE) => ({ selector: `article:has-text("${title}")` })
const bar = { clip: { x: 0, y: 44, width: 1440, height: 100 } }
/** Around what it shows in the thread: from `before` px over it to `after` under it. */
const around = (text, before = 160, after = 260) => ({ around: { text, before, after } })
const top = (height) => ({ clip: { x: 0, y: 44, width: 1440, height } })

/** Each shot: its id (ordered), the direction, the case, where, what to press first, what to take. */
export const SHOTS = [
  // One case, three ways: a task with three changes, one of which needs you.
  { id: '01-A-needs-one-task', d: 'A', s: 'needs-one', at: 'task', ...top(56) },
  { id: '02-B-needs-one-task', d: 'B', s: 'needs-one', at: 'task', ...top(100) },
  { id: '03-C-needs-one-task', d: 'C', s: 'needs-one', at: 'task', open: 'outbox', ...around('commits not shipped, on', 240, 130) },
  { id: '04-A-needs-one-card', d: 'A', s: 'needs-one', at: 'board', ...card() },
  { id: '05-B-needs-one-card', d: 'B', s: 'needs-one', at: 'board', ...card() },
  { id: '06-C-needs-one-card', d: 'C', s: 'needs-one', at: 'board', ...card() },
  // Several changes
  { id: '07-A-siblings-card', d: 'A', s: 'siblings', at: 'board', ...card() },
  { id: '08-A-stack-card', d: 'A', s: 'stack', at: 'board', ...card() },
  { id: '09-B-stack-held-strip', d: 'B', s: 'stack-held', at: 'task', open: 'motion', clip: { x: 0, y: 44, width: 760, height: 400 } },
  { id: '10-C-merged-one-thread', d: 'C', s: 'merged-one', at: 'task', ...around('#714 merged.', 40, 260) },
  // Where it works
  { id: '11-A-local-waits-bar', d: 'A', s: 'local-waits', at: 'task', ...top(56) },
  { id: '12-C-local-waits-thread', d: 'C', s: 'local-waits', at: 'task', ...around('You moved althar/board-still', 40, 220) },
  { id: '13-run-it-ask', d: 'A', s: 'run-it', at: 'task', ...around('How far should it trust', 60, 250) },
  { id: '14-to-local-ask', d: 'B', s: 'to-local', at: 'task', ...around('a branch of yours', 60, 140) },
  // Waiting for Ship
  {
    id: '15-C-held-beside-outbox',
    d: 'C',
    s: 'held-beside',
    at: 'task',
    open: 'outbox',
    ...around('commits not shipped, on', 270, 130),
  },
  { id: '16-A-held-beside-bar', d: 'A', s: 'held-beside', at: 'task', ...top(56) },
  { id: '17-merge-unshipped-ask', d: 'A', s: 'merge-unshipped', at: 'task', ...around('aren’t shipped yet', 60, 200) },
  { id: '18-B-retarget-strip', d: 'B', s: 'retarget', at: 'task', ...top(100) },
  // Reviews
  { id: '19-A-after-merge', d: 'A', s: 'after-merge', at: 'task', ...around('Found 2 in what merged', 120, 200) },
  { id: '20-B-after-merge-card', d: 'B', s: 'after-merge', at: 'board', ...card('Call “Keep for later” “Later”') },
  // Chats and presets
  { id: '21-A-scratch-corner', d: 'A', s: 'scratch', at: 'board', open: 'scratch', clip: { x: 0, y: 380, width: 760, height: 520 } },
  { id: '22-B-scratch-shelf', d: 'B', s: 'scratch', at: 'board', open: 'scratch', clip: { x: 0, y: 90, width: 1440, height: 420 } },
  { id: '23-C-scratch-talk', d: 'C', s: 'scratch', at: 'project', open: 'scratch', clip: { x: 0, y: 380, width: 760, height: 520 } },
  {
    id: '24-A-preset-chip',
    d: 'A',
    s: 'preset',
    at: 'task',
    press: 'button[aria-label^="Preset"]',
    clip: { x: 640, y: 44, width: 800, height: 330 },
  },
  // Time and failures
  {
    id: '25-C-turn-time',
    d: 'C',
    s: 'turn-time',
    at: 'task',
    press: 'text=Worked for 7m 19s',
    ...around('Worked for 7m 19s', 40, 200),
  },
  { id: '26-usage-ask', d: 'A', s: 'usage', at: 'task', ...around('is used up until', 90, 150) },
  { id: '27-refused-ask', d: 'C', s: 'refused', at: 'task', ...around('GitHub refused the push', 90, 170) },
]

const only = process.argv.slice(2)
const out = resolve(repo, 'test-results/calm-parts')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
for (const shot of SHOTS.filter((one) => only.length === 0 || only.some((id) => one.id.startsWith(id)))) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).split('\n')[0]))
  const where = shot.at === 'task' ? 'threads/th1' : shot.at === 'board' ? 'projects/p1?room=board' : 'projects/p1'
  await page.goto(`http://localhost:5374/?d=${shot.d}&s=${shot.s}&bare${shot.open === undefined ? '' : `&open=${shot.open}`}#/${where}`)
  await page.waitForTimeout(1400)
  if (shot.press !== undefined) {
    await page.locator(shot.press).first().click()
    await page.waitForTimeout(500)
  }
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
  const path = resolve(out, `${shot.id}.png`)
  if (shot.around !== undefined) {
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
