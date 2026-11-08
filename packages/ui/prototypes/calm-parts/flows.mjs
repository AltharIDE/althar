// Scrappy: the presses the review named, clicked headless: each says what the page held before and after, so a press that leaves the
// case as it was (or jumps to another) shows. node flows.mjs   (outside the sandbox: Chromium can't start in it)
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error).split('\n')[0]))

let failed = 0
const check = (ok, what) => {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${what}\n`)
  if (!ok) failed += 1
}
const text = () => page.locator('body').innerText()
const titled = () => page.title()
const open = async (d, s) => {
  await page.goto(`http://localhost:5374/?d=${d}&s=${s}#/threads/th1`)
  await page.waitForTimeout(900)
}
const parts = async () => {
  const label = await page.locator('button[aria-label^="Parts,"]').first().getAttribute('aria-label')
  return Number(/Parts, (\d+)/.exec(label ?? '')?.[1] ?? 0)
}
const press = async (name, scope = page) => {
  await scope.getByRole('button', { name, exact: true }).first().click()
}
const settle = (ms) => page.waitForTimeout(ms)

/* ——— Ship, on the change it is pressed for ——— */

// B: the held #716 in a stack: its card's Ship ships #714 first, then #716, and stays in this case.
await open('B', 'stack-held')
await page.getByRole('button', { name: /^#716/ }).first().click()
await settle(300)
await page.locator('[role=dialog], [role=region]').getByRole('button', { name: 'Ship', exact: true }).first().click()
await settle(500)
let t = await text()
check((await titled()).includes('A hold reaching up a stack'), 'B stack-held: Ship stays in the case')
check(t.includes('Shipping #714, then #716'), 'B stack-held: the scope ask is answered bottom-up')
await settle(5200)
t = await text()
check(t.includes('Shipped: #714 has the 2 commits'), 'B stack-held: #714 went up with its 2 commits')
check(t.includes('#716 went up on top of'), 'B stack-held: #716 went up after it')

// A: the same from the bar's chip.
await open('A', 'stack-held')
await press('Ship')
await settle(500)
t = await text()
check((await titled()).includes('A hold reaching up a stack'), 'A stack-held: the chip’s Ship stays in the case')
check(t.includes('Shipping #714, then #716'), 'A stack-held: the chip answers the ask')
await settle(5200)
t = await text()
check(t.includes('Shipped: #714 has the 2 commits') && t.includes('#716 went up'), 'A stack-held: both went up, in order')

// C: the outbox, one change's row.
await open('C', 'held-beside')
await page
  .getByRole('button', { name: /not shipped/ })
  .first()
  .click()
await settle(300)
await page.locator('[role=dialog]').getByRole('button', { name: 'Ship', exact: true }).first().click()
await settle(300)
t = await text()
check((await titled()).includes('Fixes and replies waiting beside'), 'C held-beside: Ship stays in the case')
await settle(4200)
t = await text()
check(
  t.includes('Shipped: #714 has the 3 commits and the answer to the reply on it'),
  'C held-beside: shipped with the reply, checks running again',
)

// The retargeted branch: Ship keeps its target, opens its pull request, then asks about the old one.
await open('B', 'retarget')
await page
  .getByRole('button', { name: /^althar\/board-still-2/ })
  .first()
  .click()
await settle(300)
await page.locator('[role=dialog], [role=region]').getByRole('button', { name: 'Ship', exact: true }).first().click()
await settle(5200)
t = await text()
check((await titled()).includes('A new target while held'), 'B retarget: Ship stays in the case')
check(
  t.includes('althar/board-still-2 is up as #719, into release/0.8.0'),
  'B retarget: the new pull request goes into release/0.8.0, not main',
)
check(t.includes('#714') && t.includes('is still open'), 'B retarget: only then asks about the old #714')

/* ——— Parts: added, removed ——— */

await open('A', 'one')
const before = await parts()
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
await press('Add')
await page
  .getByRole('button', { name: /^A change/ })
  .first()
  .click()
await press('Start one')
await settle(500)
t = await text()
check((await parts()) === before + 1, `A one: Start one adds a part (${before} → ${await parts()})`)
check(t.includes('You started a change, althar/board-still-tests'), 'A one: and says so in the thread')
check(/2 changes|althar\/board-still-tests/.test(t), 'A one: the new change is on the task')

await open('B', 'one')
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
await press('Add')
await page
  .getByRole('button', { name: /^A change/ })
  .first()
  .click()
await press('Start one')
await settle(500)
await page.keyboard.press('Escape')
await settle(300)
t = await text()
check(t.includes('althar/board-still-tests'), 'B one: a strip appears with the new change')

await open('A', 'one')
const withReviewer = await parts()
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
await page
  .getByRole('button', { name: /Checked by/ })
  .first()
  .click()
await settle(250)
await press('Remove')
await settle(500)
check((await parts()) === withReviewer - 1, `A one: Remove Checked by takes the part away (${withReviewer} → ${await parts()})`)
await page.keyboard.press('Escape')
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
check(!(await page.locator('[role=dialog]').innerText()).includes('Checked by'), 'A one: the parts no longer list Checked by')

/* ——— Access ——— */

await open('A', 'run-it')
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
check((await page.locator('[role=dialog]').innerText()).includes('Read only'), 'A run-it: Access reads “Read only” before')
await page.keyboard.press('Escape')
await press('Trust fully')
await settle(2600)
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
t = await page.locator('[role=dialog]').innerText()
check(t.includes('Trusted') && !t.includes('Read only'), 'A run-it: Trust fully makes Access “Trusted”')
await page.keyboard.press('Escape')

await open('A', 'runs-safely')
await page.getByRole('button', { name: 'Trust fully' }).first().click()
await settle(2600)
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
t = await page.locator('[role=dialog]').innerText()
check(t.includes('Trusted') && !t.includes('Runs safely'), 'A runs-safely: Trust fully on the line makes Access “Trusted”')
await page.keyboard.press('Escape')

await open('B', 'trusted')
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
t = await page.locator('[role=dialog]').innerText()
check(t.includes('Trusted'), 'B trusted: the fully trusted case is in the picker and reads “Trusted”')

/* ——— The other presses: each changes the case it is pressed in ——— */

const inCase = async (label, what) => check((await titled()).includes(label), `${what}: stays in the case`)

// Merge a ready stack, bottom up.
await open('A', 'stack')
await press('Merge #714, then #716')
await settle(3600)
t = await text()
check(t.includes('#714 merged. #716 goes into main now.') && t.includes('#716 merged.'), 'A stack: Merge merges #714, then #716')
await inCase('A stack, ready to merge', 'A stack')

// Fix a failing check: its commit waits for Ship, as the ADR has it.
await open('A', 'needs-one')
await press('Fix it')
await settle(2600)
t = await text()
check(
  t.includes('One commit, not shipped: e2e (board.spec.ts) still fails on #714'),
  'A needs-one: Fix it writes a commit that waits beside the failing head',
)

// Out of Local: wait, then call it off.
await open('A', 'local-waits')
await press('Call it off')
await settle(500)
t = await text()
check(t.includes('You called off the move'), 'A local-waits: Call it off says so')
await inCase('Out of Local, waiting on your edits', 'A local-waits')

// Into the checkout: the ask, then Switch.
await open('A', 'to-local')
await page
  .getByRole('button', { name: /^Switch to/ })
  .first()
  .click()
await settle(900)
t = await text()
check(
  t.includes('You moved althar/board-still to your checkout. It goes back to balazs/notes'),
  'A to-local: Switch moves it to the checkout',
)
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
await page.locator('[role=dialog]').getByRole('button', { name: /#714/ }).first().click()
await settle(250)
check((await page.locator('[role=dialog]').innerText()).includes('Your checkout'), 'A to-local: the change reads “Your checkout” now')
await page.keyboard.press('Escape')

// From a part: Move to your checkout asks first, in the same case.
await open('A', 'held')
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
await page.locator('[role=dialog]').getByRole('button', { name: /#714/ }).first().click()
await settle(250)
await press('Move to your checkout')
await settle(900)
t = await text()
check(
  t.includes('Your checkout is on balazs/notes') && (await titled()).includes('Commits not shipped'),
  'A held: Move to your checkout asks first, in the same case',
)

// Merge with commits not shipped: Review and merge goes up, then merges.
await open('A', 'merge-unshipped')
await press('Review and merge')
await settle(5600)
t = await text()
check(t.includes('Shipped: #714 has the 2 commits') && t.includes('#714 merged.'), 'A merge-unshipped: Review and merge ships, then merges')

// Settle with commits not shipped: ship, then settle.
await open('A', 'settle-unshipped')
await press('Ship, then settle')
await settle(5600)
t = await text()
check(
  t.includes('Shipped: althar/calmer-empty-board is up as #719') && (await text()).includes('Settled'),
  'A settle-unshipped: Ship, then settle ends settled',
)

// After the merge, it found something: Fix it starts a change after it.
await open('A', 'after-merge')
await press('Fix it')
await settle(600)
t = await text()
check(t.includes('Started althar/rename-later-fix, after #715, for the 2 findings.'), 'A after-merge: Fix it starts a change after #715')

// A removed review with a draft asks first; answering removes it.
await open('B', 'reviewing-related')
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
await page.locator('[role=dialog]').getByRole('button', { name: /#698/ }).first().click()
await settle(250)
await page.locator('[role=dialog]').getByRole('button', { name: 'Remove', exact: true }).click()
await settle(700)
t = await text()
check(
  t.includes('Remove the review of #698') && (await titled()).includes('A change reviewing a related PR'),
  'B reviewing-related: Remove asks first, in the same case',
)
await page.getByRole('button', { name: 'Remove without posting' }).first().click()
await settle(600)
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
check(!(await page.locator('[role=dialog]').innerText()).includes('#698'), 'B reviewing-related: and the review is gone from the parts')
await page.keyboard.press('Escape')

// Failures, each with its way out.
await open('A', 'usage')
await page
  .getByRole('button', { name: /^Continue with/ })
  .first()
  .click()
await settle(600)
check((await text()).includes('Moved to DeepSeek V4.1 Flash'), 'A usage: the kit’s card moves the lead to the first free model')
await open('A', 'stuck')
await press('Try again')
await settle(4200)
check((await text()).includes('Shipped: #714 has the 2 commits'), 'A stuck: Try again runs the step again and ships')
await open('A', 'refused')
await press('Set up signing')
await settle(4200)
check((await text()).includes('Shipped: #714 has the 3 commits'), 'A refused: Set up signing ships')
await open('A', 'unmatched')
await page.getByRole('button', { name: 'Attach it as its own change' }).first().click()
await settle(500)
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
check((await page.locator('[role=dialog]').innerText()).includes('#718'), 'A unmatched: Attach adds #718 as a change')
await page.keyboard.press('Escape')

// A chat takes a worktree; a part's Remove takes the folder.
await open('A', 'scratch')
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
await page
  .locator('[role=dialog]')
  .getByRole('button', { name: /A copy of main/ })
  .first()
  .click()
await settle(250)
await press('Take a worktree')
await settle(600)
check((await text()).includes('You gave it a worktree'), 'A scratch: Take a worktree adds a change')
await page.keyboard.press('Escape')

// Undo takes an answer back, and what it started.
await open('A', 'stack-held')
await press('Ship')
await settle(500)
await page.getByRole('button', { name: /Undo/ }).first().click()
await settle(2500)
t = await text()
check(
  t.includes('Ship #716, and the 2 commits on #714') && !t.includes('Shipped: #714'),
  'A stack-held: Undo gives the ask back and stops the Ship',
)

// Start over puts a case back.
await page
  .getByRole('button', { name: 'Start over' })
  .first()
  .click()
  .catch(() => undefined)

/* ——— Round two: Outputs, the branch the conversation is on, the plan card's preset, the pickers on the error cards ——— */

// Outputs: the change that most needs you, the rest a line each; a line shows its change.
await page.goto('http://localhost:5374/?d=A&s=needs-one&face=out#/threads/th1')
await settle(1200)
t = (await text()).toLowerCase()
check(t.includes('what #714 changes') && t.includes('2 more changes'), 'A needs-one Outputs: #714 first, then 2 more changes')
await page.getByRole('button', { name: /#715/ }).first().click()
await settle(400)
check((await text()).toLowerCase().includes('what #715 changes'), 'A needs-one Outputs: pressing #715’s line shows #715')

// The branch the conversation is on, in the composer, and turning it to another.
await open('A', 'needs-one')
check(
  await page.getByRole('button', { name: 'On althar/board-still' }).isVisible(),
  'A needs-one: the composer names the branch the conversation is on',
)
await page.getByRole('button', { name: 'On althar/board-still' }).click()
await settle(250)
await page.getByRole('menuitem', { name: /althar\/rename-later/ }).click()
await settle(500)
t = await text()
check(t.includes('You turned the conversation to #715, althar/rename-later.'), 'A needs-one: turning it to #715 says so')
check(await page.getByRole('button', { name: 'On althar/rename-later' }).isVisible(), 'A needs-one: and the composer names its branch')
await open('A', 'one')
check((await page.getByRole('button', { name: /^On althar\// }).count()) === 0, 'A one: one change, no branch chip (as today)')

// The plan card names the preset; another preset changes its steps.
await page.goto('http://localhost:5374/?d=A&s=needs-one#/projects/p1?room=talk')
await settle(1500)
const launch = page.locator('[class*="TaskLaunch-module__launch"]').first()
check((await launch.innerText()).includes('Review'), 'Plan card: Change has a review step')
await launch.getByRole('button', { name: 'Preset: Change' }).click()
await settle(250)
await page.getByRole('menuitem', { name: /^Prototype/ }).click()
await settle(400)
check(
  !(await launch.innerText()).includes('Review') && (await launch.getByRole('button', { name: 'Preset: Prototype' }).count()) === 1,
  'Plan card: Prototype drops the review step',
)
await page.goto('http://localhost:5374/?d=A&s=needs-one#/threads/th1')
await settle(900)
check(
  (await page.locator('header[aria-label]').first().innerText()).includes('Change') === false,
  'A needs-one: no preset chip in the task’s bar',
)

// The stuck card's picker: another model takes the review, and Ship goes on.
await open('A', 'stuck')
await page
  .getByRole('button', { name: /Review with another model/ })
  .first()
  .click()
await settle(300)
await page
  .getByRole('menuitem', { name: /GPT-6.1 Terra/ })
  .first()
  .click()
await settle(4200)
t = await text()
check(
  t.includes('Reviewing with GPT-6.1 Terra') && t.includes('Shipped: #714 has the 2 commits'),
  'A stuck: picking GPT-6.1 Terra reviews with it, then ships',
)

process.stdout.write(`${failed} failed; page errors: ${errors.length === 0 ? 'none' : [...new Set(errors)].join(' | ')}\n`)
await browser.close()
