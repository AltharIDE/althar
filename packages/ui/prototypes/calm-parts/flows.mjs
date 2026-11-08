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

const dock = () => page.locator('section[aria-label="This task’s changes"]')
const switcher = () => page.getByRole('button', { name: /^Showing / })

/* ——— Ship, on the change it is pressed for ——— */

// A · As one: the held stack's chip ships the change below first, then the one on it, and stays in this case.
await open('A', 'stack-held')
await press('Ship')
await settle(500)
let t = await text()
check((await titled()).includes('A hold reaching up a stack'), 'A stack-held: the chip’s Ship stays in the case')
check(t.includes('Shipping Lane heights, then Card slide'), 'A stack-held: the chip answers the ask, bottom up')
await settle(5200)
t = await text()
check(
  t.includes('Shipped: Lane heights (#714) has the 2 commits') && t.includes('Card slide (#716) went up on top of'),
  'A stack-held: both went up, in order, each naming its pull request',
)

// B · One at a time: the window opens on the change the ask is about; the switch turns it to the one below, whose Ship ships it alone.
await open('B', 'stack-held')
check((await switcher().getAttribute('aria-label')) === 'Showing Card slide', 'B stack-held: opens on Card slide, which the ask is about')
await switcher().click()
await settle(250)
await page.getByRole('menuitem', { name: /Lane heights/ }).click()
await settle(400)
check((await switcher().getAttribute('aria-label')) === 'Showing Lane heights', 'B stack-held: the switch turns the window to Lane heights')
check(!(await text()).includes('You turned'), 'B stack-held: turning it writes nothing in the thread')
check(
  (await page.locator('header[aria-label]').first().innerText()).includes('2 commits not shipped'),
  'B stack-held: the chip is Lane heights’ own: 2 commits not shipped',
)
await press('Ship')
await settle(4600)
check((await text()).includes('Shipped: Lane heights (#714) has the 2 commits'), 'B stack-held: its Ship ships Lane heights')

// C · Where you talk: a tab picks the change; pressed again, its card, whose Ship ships it.
await open('C', 'stack-held')
check(
  (await dock().getByRole('button', { pressed: true }).innerText()).includes('Card slide'),
  'C stack-held: the tab picked is Card slide',
)
await dock()
  .getByRole('button', { name: /^Lane heights/ })
  .click()
await settle(300)
check(
  (await dock().getByRole('button', { pressed: true }).innerText()).includes('Lane heights'),
  'C stack-held: pressing Lane heights picks it',
)
await dock().getByRole('button', { pressed: true }).click()
await settle(300)
await page.locator('[role=dialog]').getByRole('button', { name: 'Ship', exact: true }).first().click()
await settle(4600)
check((await text()).includes('Shipped: Lane heights (#714) has the 2 commits'), 'C stack-held: the tab’s card ships Lane heights')

// One change, waiting beside a reply and a failing check: the chip's Ship takes them all.
await open('A', 'held-beside')
await press('Ship')
await settle(4600)
check(
  (await text()).includes('Shipped: #714 has the 3 commits and the answer to the reply on it'),
  'A held-beside: shipped with the reply, checks running again',
)

// The retargeted branch: Ship keeps its target, opens its pull request, then asks about the old one.
await open('A', 'retarget')
await press('Ship')
await settle(5200)
t = await text()
check((await titled()).includes('A new target while held'), 'A retarget: Ship stays in the case')
check(
  t.includes('althar/board-still-2 is up as #719, into release/0.8.0'),
  'A retarget: the new pull request goes into release/0.8.0, not main',
)
check(t.includes('#714') && t.includes('is still open'), 'A retarget: only then asks about the old #714')

/* ——— Parts: added, removed; a second change, in each direction's place ——— */

const startOne = async () => {
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
}
await open('A', 'one')
await startOne()
t = await text()
check(t.includes('You started a change, althar/board-still-tests'), 'A one: Start one says so in the thread')
check(
  ((await page.getByRole('button', { name: /^2 changes:/ }).count()) ?? 0) === 1,
  'A one: the chip now holds a mark for each of the 2 changes',
)
await open('B', 'one')
check((await switcher().count()) === 0, 'B one: one change, no switch after the title (as today)')
await startOne()
check((await switcher().count()) === 1, 'B one: a second change brings the switch after the title')
await open('C', 'one')
check((await dock().count()) === 0, 'C one: one change, no tabs over the composer (as today)')
await startOne()
check((await dock().getByRole('button').count()) === 2, 'C one: a second change brings a tab each over the composer')

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
await press('Merge both')
await settle(3600)
t = await text()
check(
  t.includes('Lane heights (#714) merged. Card slide goes into main now.') && t.includes('Card slide (#716) merged.'),
  'A stack: Merge both merges Lane heights, then Card slide',
)
await inCase('A stack, ready to merge', 'A stack')

// Fix a failing check: its commit waits for Ship, as the ADR has it.
await open('A', 'needs-one')
await press('Fix it')
await settle(2600)
t = await text()
check(
  t.includes('One commit, not shipped: e2e (board.spec.ts) still fails on Lane heights'),
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
await open('C', 'reviewing-related')
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
await page.locator('[role=dialog]').getByRole('button', { name: /#698/ }).first().click()
await settle(250)
await page.locator('[role=dialog]').getByRole('button', { name: 'Remove', exact: true }).click()
await settle(700)
t = await text()
check(
  t.includes('Remove the review of #698') && (await titled()).includes('A change reviewing a related PR'),
  'C reviewing-related: Remove asks first, in the same case',
)
await page.getByRole('button', { name: 'Remove without posting' }).first().click()
await settle(600)
await page.locator('button[aria-label^="Parts,"]').first().click()
await settle(250)
check(!(await page.locator('[role=dialog]').innerText()).includes('#698'), 'C reviewing-related: and the review is gone from the parts')
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
await page.getByRole('button', { name: /^2 changes:/ }).click()
await settle(250)
check((await page.locator('[role=dialog]').innerText()).includes('#718'), 'A unmatched: Attach adds #718 as a change, a mark in the chip')
await page.keyboard.press('Escape')
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
  t.includes('Ship Card slide, and the 2 commits on Lane heights') && !t.includes('Shipped: Lane heights'),
  'A stack-held: Undo gives the ask back and stops the Ship',
)

// Start over puts a case back.
await page
  .getByRole('button', { name: 'Start over' })
  .first()
  .click()
  .catch(() => undefined)

/* ——— Round three: Outputs and the change in view, as each direction has them; the plan card's preset; the error cards' pickers ——— */

const outputs = async (d, k = 'needs-one') => {
  await page.goto(`http://localhost:5374/?d=${d}&s=${k}&face=out#/threads/th1`)
  await settle(1200)
  return (await text()).toLowerCase()
}
for (const d of ['A', 'B', 'C']) {
  t = await outputs(d)
  check(
    t.includes('what lane heights changes') && t.includes('what rename changes') && t.includes('what card slide changes'),
    `${d} needs-one Outputs: every change, one under another`,
  )
}
// A merged change folds to a line while another is open, and opens on a press; the open one stays as it was.
t = await outputs('A', 'merged-one')
check(t.includes('#714 merged') && !t.includes('what lane heights changes'), 'A merged-one Outputs: the merged change is a line')
check(t.includes('what card slide changes'), 'A merged-one Outputs: the open change is in full')
await page.getByRole('button', { name: /#714 merged/ }).click()
await settle(500)
check((await text()).toLowerCase().includes('what lane heights changes'), 'A merged-one Outputs: its line opens to all it made')

// One at a time: the composer says which change what you say goes to; a name in a line is a way to it.
await open('B', 'needs-one')
const field = () => page.locator('textarea, [contenteditable=true]').last()
check(
  ((await field().getAttribute('placeholder')) ?? (await field().getAttribute('aria-placeholder')) ?? (await text())).includes(
    'about Lane heights',
  ),
  'B needs-one: the composer says what you say goes to Lane heights',
)
await switcher().click()
await settle(250)
await page.getByRole('menuitem', { name: /Rename/ }).click()
await settle(400)
await page.getByRole('button', { name: 'Lane heights', exact: true }).first().click()
await settle(400)
check(
  (await switcher().getAttribute('aria-label')) === 'Showing Lane heights',
  'B needs-one: “Lane heights” in a line turns the window back to it',
)

// As one: the chip's marks open to every change, each with its branch and where it stands.
await open('A', 'needs-one')
await page.getByRole('button', { name: /^3 changes:/ }).click()
await settle(300)
t = await page.locator('[role=dialog]').innerText()
check(
  t.includes('althar/board-still') &&
    t.includes('althar/rename-later') &&
    t.includes('althar/board-motion') &&
    t.includes('Ready to merge'),
  'A needs-one: the marks open to each change, its branch and where it stands',
)
await page.keyboard.press('Escape')

// The plan card names the preset; another preset changes its steps.
await page.goto('http://localhost:5374/?d=A&s=needs-one#/projects/p1?room=talk')
await settle(1500)
const launch = page.locator('[class*="TaskLaunch-module__launch"]').first()
check((await launch.innerText()).includes('Review'), 'Plan card: Change has a review step')
check((await launch.innerText()).startsWith('Change · Task'), 'Plan card: the preset is the kicker’s first word')
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
