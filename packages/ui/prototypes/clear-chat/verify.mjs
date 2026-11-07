// Scrappy: what each placement does, checked against the live page: node verify.mjs
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text().slice(0, 300))
})

const open = async (direction) => {
  await page.goto(`http://localhost:5363/?d=${direction}&bare&r=${Date.now()}#/projects/p1?room=both`)
  await page.waitForTimeout(1400)
}
const text = () => page.locator('section[aria-label="Conversation"]').innerText()
const has = async (words) => (await text()).includes(words)
const click = (name) => page.getByRole('button', { name }).first().click()
const exact = (name) => page.getByRole('button', { name, exact: true }).first().click()
const say = async (words) => {
  const field = page.locator('[contenteditable=true], textarea').first()
  await field.click()
  await field.fill(words)
  await field.press('Enter')
  await page.waitForTimeout(2600)
}
const ring = async () => {
  await page.getByRole('button', { name: /Context \d+% used/ }).hover()
  await page.waitForTimeout(600)
}
const ask = async (direction) => {
  if (direction === 'C') await ring()
  await (direction === 'C' ? click('Clear chat…') : exact('Clear'))
  await page.waitForTimeout(500)
}
const clearView = async (direction) => {
  await ask(direction)
  await page.getByRole('radio', { name: /Keep what the coordinator knows/ }).click()
  await page.waitForTimeout(200)
  await click('Clear the view')
  await page.waitForTimeout(900)
}
const forget = async (direction) => {
  await ask(direction)
  await page.getByRole('radio', { name: /Forget it too/ }).click()
  await page.waitForTimeout(200)
  await click('Clear and forget')
  await page.waitForTimeout(900)
}

let failed = 0
const check = (name, ok) => {
  if (!ok) failed += 1
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}\n`)
}

// A: the control in the composer, the dialog with both kinds, and the view's way back.
await open('A')
check('A has Clear in the composer', (await page.getByRole('button', { name: 'Clear', exact: true }).count()) === 1)
await ask('A')
check('A opens the question with both kinds', (await page.getByRole('radio').count()) === 2)
await page.getByRole('button', { name: 'Cancel' }).click()
await page.waitForTimeout(300)
await clearView('A')
check('A clears the view', (await has('Cleared')) && !(await has('GitLab pipelines stop at 100')))
check('A keeps open work', (await has('Board: lane counts jump')) && (await has('Prototype: clearing a coordinator chat')))
await click('Show earlier')
await page.waitForTimeout(700)
check('A shows the earlier conversation', (await has('GitLab pipelines stop at 100')) && (await has('Back to now')))
await click('Back to now')
await page.waitForTimeout(700)
check('A comes back to the cleared view', !(await has('GitLab pipelines stop at 100')))
await click('Undo')
await page.waitForTimeout(700)
check('A Undo brings the conversation back', (await has('GitLab pipelines stop at 100')) && !(await has('Cleared')))

// A: /clear is the same door, and sends nothing.
await open('A')
const field = page.locator('[contenteditable=true], textarea').first()
await field.click()
await field.fill('/clear')
await field.press('Enter')
await page.waitForTimeout(600)
check('A /clear opens the question', (await page.getByRole('radio').count()) === 2)
await page.getByRole('button', { name: 'Cancel' }).click()
await page.waitForTimeout(400)
check('A /clear sends nothing', !(await has('/clear')))

// A: after a light clear the coordinator still knows; after a wipe it doesn't.
await open('A')
await clearView('A')
await say('Where were we?')
check('A after a clear: the coordinator remembers', await has('We were on three things'))
await open('A')
await forget('A')
check('A wipes the conversation', (await has('Fresh session')) && !(await has('GitLab pipelines stop at 100')))
check('A wipe keeps open work', (await has('Board: lane counts jump')) && (await has('Prototype: clearing a coordinator chat')))
await say('Where were we?')
check(
  'A after a wipe: the coordinator is fresh',
  (await has('I’ve nothing of an earlier conversation')) && !(await has('We were on three things')),
)

// B: the bar above the thread, and the same two kinds.
await open('B')
check(
  'B has a coordinator bar with Clear',
  (await page.getByText('Coordinator', { exact: true }).count()) > 0 &&
    (await page.getByRole('button', { name: 'Clear', exact: true }).count()) === 1,
)
await clearView('B')
check('B clears the view', (await has('Cleared')) && !(await has('GitLab pipelines stop at 100')))
await click('Show earlier')
await page.waitForTimeout(700)
check('B shows the earlier conversation', (await has('GitLab pipelines stop at 100')) && (await has('Back to now')))
await click('Back to now')
await page.waitForTimeout(700)
await click('Undo')
await page.waitForTimeout(700)
check('B Undo brings the conversation back', (await has('GitLab pipelines stop at 100')) && !(await has('Cleared')))
await forget('B')
check('B wipes the conversation', (await has('Fresh session')) && !(await has('GitLab pipelines stop at 100')))

// C: the context ring, the same session after a light clear, none after a wipe.
await open('C')
await ring()
check(
  "C has the ring's foot: Clear chat… and Compact",
  (await page.getByRole('button', { name: 'Clear chat…' }).count()) === 1 &&
    (await page.getByRole('button', { name: 'Compact' }).count()) === 1,
)
await page.getByRole('button', { name: 'Clear chat…' }).click()
await page.waitForTimeout(500)
check('C opens on the wipe, with the light clear offered', (await page.getByRole('radio', { name: /Forget it too/ }).isChecked()) === true)
await page.getByRole('radio', { name: /Keep what the coordinator knows/ }).click()
await page.waitForTimeout(200)
await click('Clear the view')
await page.waitForTimeout(900)
check('C clears the view', (await has('Cleared')) && !(await has('GitLab pipelines stop at 100')))
check('C keeps the session after a clear', (await page.getByRole('button', { name: /Context \d+% used/ }).count()) === 1)
await open('C')
await forget('C')
check('C wipes the conversation', (await has('Fresh session')) && !(await has('GitLab pipelines stop at 100')))
check('C has no session after a wipe', (await page.getByRole('button', { name: /Context \d+% used/ }).count()) === 0)

// The board is never part of a clear.
await open('A')
await clearView('A')
check(
  'the board is untouched',
  (await page.getByText('Running', { exact: true }).count()) > 0 && (await page.getByText('Up next', { exact: true }).count()) > 0,
)

process.stdout.write(errors.length === 0 ? 'no page errors\n' : `PAGE ERRORS: ${errors.join(' | ')}\n`)
process.stdout.write(`${failed === 0 ? 'all checks passed' : `${failed} checks failed`}\n`)
await browser.close()
process.exit(failed === 0 && errors.length === 0 ? 0 : 1)
