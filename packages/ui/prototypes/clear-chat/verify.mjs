// The states the screenshots can't prove: undo, the earlier chat, the brief changing an answer, focus, and a wipe.
// Run against the live page, from the repository's root: node packages/ui/prototypes/clear-chat/verify.mjs
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
let failed = 0

const open = async (direction) => {
  await page.goto(`http://localhost:5363/?d=${direction}&bare#/projects/p1?room=both`)
  await page.waitForTimeout(1300)
}
const text = () => page.locator('section[aria-label="Conversation"]').innerText()
const has = async (words) => (await text()).includes(words)
const press = (name) => page.getByRole('button', { name }).first().click()
const say = async (words) => {
  const field = page.locator('[contenteditable=true], textarea').first()
  await field.click()
  await field.fill(words)
  await field.press('Enter')
  await page.waitForTimeout(2500)
}
const check = (name, ok) => {
  if (!ok) failed += 1
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}\n`)
}

await open('A')
await press('New page')
await page.waitForTimeout(700)
check('A new page: the handover shows', await has('Where we left off'))
check('A new page: the earlier talk is not on the page', !(await has('GitLab pipelines stop at 100')))
await press('Undo')
await page.waitForTimeout(700)
check('A Undo: the handover goes', !(await has('Where we left off')))
check('A Undo: the conversation is back', await has('GitLab pipelines stop at 100'))

await open('B')
await press('New chat')
await page.waitForTimeout(700)
check('B New chat: the talk is gone', !(await has('GitLab pipelines stop at 100')))
check('B New chat: the earlier chat is offered', await has('Earlier chat'))
check('B New chat: the open work stays', await has('Connectors: GitLab pages past 100'))
await press('Read')
await page.waitForTimeout(700)
check('B Read: the earlier chat is back', await has('GitLab pipelines stop at 100'))
await press('Back to now')
await page.waitForTimeout(700)
check('B Back: the current chat again', !(await has('GitLab pipelines stop at 100')))

await open('B')
await press('What it knows')
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Forget: You asked me to merge/ }).click()
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await say('Where were we?')
check('B brief: a forgotten line is not in the answer', !(await has('Once its checks pass')))
check('B brief: the other lines are', await has('Prototype: clearing a coordinator chat'))

await open('C')
const before = (await text()).length
await press('Focus')
await page.waitForTimeout(700)
check('C Focus: the thread is shorter', (await text()).length < before)
check('C Focus: the last exchange stays', await has('How much of the week’s plan usage is left?'))
await press('Show all')
await page.waitForTimeout(700)
check('C Show all: the thread is back', (await text()).length >= before - 20)

await open('B')
await press('What it knows')
await page.waitForTimeout(300)
await press('Forget everything…')
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Forget it', exact: true }).first().click()
await page.waitForTimeout(700)
check('B forget: the talk is gone', !(await has('GitLab pipelines stop at 100')))
check('B forget: the open work stays', (await has('Connectors: GitLab pages past 100')) && (await has('Board: lane counts jump')))
await press('What it knows')
await page.waitForTimeout(400)
check('B forget: the brief is empty', (await page.getByText('Nothing from the conversation.').count()) === 1)

check('no page errors', errors.length === 0)
await browser.close()
process.stdout.write(`${failed === 0 ? 'all checks passed' : `${failed} checks failed`}\n`)
process.exitCode = failed === 0 ? 0 : 1
