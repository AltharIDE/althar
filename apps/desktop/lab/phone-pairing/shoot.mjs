// Shoots each direction in its states, at 1×, the app's window only, into lab/phone-pairing/shots (the lab running on
// 6189): node lab/phone-pairing/shoot.mjs [name…], from apps/desktop. Chromium can't start in an agent's sandbox on a
// Mac; run it outside.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })

const click = (name) => async (page) => page.getByRole('button', { name }).first().click()
const item = (name) => async (page) => page.getByRole('menuitem', { name }).first().click()
const key = (k) => async (page) => page.keyboard.press(k)
const home = async (page) => page.locator('button', { hasText: 'Keeps your projects' }).first().click()
const meter = async (page) => page.locator('button', { hasText: 'CPU' }).first().click()
const homes = async (page) =>
  page
    .getByRole('button', { name: /Homes$/ })
    .first()
    .click()

const shots = [
  // A · beside the workers
  ['a-1-computers', 'd=a', []],
  ['a-2-pair', 'd=a', [click('Add a phone')]],
  ['a-3-paired', 'd=a', [click('Add a phone'), key('s')]],
  ['a-4-computers-after', 'd=a', [click('Add a phone'), key('s'), click('Done')]],
  ['a-5-expired', 'd=a', [click('Add a phone'), key('x')]],
  ['a-6-phone', 'd=a', [click(/^Android phone/)]],
  ['a-7-remove', 'd=a', [click(/^Android phone/), click('Remove Android phone')]],
  ['a-8-empty', 'd=a&phones=none', []],
  ['a-9-mac-unreachable', 'd=a&reach=0', [click('Add a phone')]],
  ['a-10-studio', 'd=a&home=studio', []],
  ['a-11-studio-pair', 'd=a&home=studio', [click('Add a phone')]],
  ['a-12-studio-unreachable', 'd=a&home=studio&reach=0', [click('Add a phone')]],
  ['a-13-many', 'd=a&phones=many', []],
  ['a-14-short-code', 'd=a&short=1', [click('Add a phone')]],
  ['a-15-dark', 'd=a&theme=dark', [click('Add a phone')]],
  ['a-16-dark-computers', 'd=a&theme=dark', []],
  ['a-17-narrow', 'd=a&narrow=1', [click('Add a phone')]],
  // B · part of the home
  ['b-1-computers', 'd=b', []],
  ['b-2-home', 'd=b', [home]],
  ['b-3-pair', 'd=b', [home, click('Pair a phone')]],
  ['b-4-paired', 'd=b', [home, click('Pair a phone'), key('s')]],
  ['b-5-empty', 'd=b&phones=none', [home]],
  ['b-6-studio', 'd=b&home=studio', [home]],
  ['b-7-dark', 'd=b&theme=dark', [home, click('Pair a phone')]],
  // C · in the popover
  ['c-1-popover', 'd=c', [meter]],
  ['c-2-pair', 'd=c', [meter, click('Pair a phone')]],
  ['c-3-paired', 'd=c', [meter, click('Pair a phone'), key('s')]],
  ['c-4-empty', 'd=c&phones=none', [meter]],
  ['c-5-studio', 'd=c&home=studio', [meter]],
  ['c-6-dark', 'd=c&theme=dark', [meter, click('Pair a phone')]],
  ['c-7-mac-unreachable', 'd=c&reach=0', [meter, click('Pair a phone')]],
  // D · from the homes menu
  ['d-1-menu', 'd=d', [homes]],
  ['d-2-dialog', 'd=d', [homes, item(/^Pair a phone/)]],
  ['d-3-paired', 'd=d', [homes, item(/^Pair a phone/), key('s')]],
  ['d-4-studio-menu', 'd=d&home=studio', [homes]],
  ['d-5-studio', 'd=d&home=studio', [homes, item(/^Pair a phone/)]],
  ['d-6-empty', 'd=d&phones=none', [homes, item(/^Pair a phone/)]],
  ['d-7-dark', 'd=d&theme=dark', [homes, item(/^Pair a phone/)]],
]

const only = process.argv.slice(2)
const browser = await chromium.launch()
for (const [name, query, steps] of shots) {
  if (only.length > 0 && !only.some((one) => name.startsWith(one))) continue
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6189/?${String(query)}`)
  await page.waitForTimeout(1200)
  for (const step of steps) {
    await step(page)
    await page.waitForTimeout(700)
  }
  await page.waitForTimeout(400)
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${String(name)}.png`) })
  await page.close()
}
await browser.close()
