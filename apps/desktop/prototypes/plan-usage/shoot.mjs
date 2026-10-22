// Scrappy: every shot in shots.json, headless, at 1x, a 1280×800 window, into shots/ (git ignores it): node shoot.mjs [id…]. The server must be up (see README); outside the agent sandbox (Chromium can't start in it).
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import shots from './shots.json' with { type: 'json' }

const require = createRequire(resolve(import.meta.dirname, '../../package.json'))
const { chromium } = require('@playwright/test')

const out = resolve(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)

const browser = await chromium.launch()
const shoot = async (shot) => {
  // en-GB, so the app's own times read 14:00 as the words do.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-GB' })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://localhost:5441/${shot.page}`)
  await page.waitForTimeout(shot.wait ?? 2500)
  // What the person would do first: open a tab, bring a card into view, point at something.
  if (shot.click !== undefined) {
    await page.locator(shot.click).first().click()
    await page.waitForTimeout(700)
  }
  if (shot.scroll !== undefined) {
    await page.locator(shot.scroll).first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
  }
  if (shot.hover !== undefined) {
    await page.locator(shot.hover).first().hover()
    await page.waitForTimeout(900)
  }
  // A shot's clip, [x, y, width, height], keeps it to the part it is about.
  const clip = shot.clip === undefined ? {} : { clip: { x: shot.clip[0], y: shot.clip[1], width: shot.clip[2], height: shot.clip[3] } }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`), ...clip })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
const list = shots.filter((one) => only.length === 0 || only.includes(one.id))
// A few at once: the machine is shared.
// One that fails says why and lets the rest go on.
const tried = (shot) => shoot(shot).catch((error) => process.stdout.write(`${shot.id}  FAILED ${String(error).split('\n')[0]}\n`))
for (let at = 0; at < list.length; at += 3) await Promise.all(list.slice(at, at + 3).map(tried))
await browser.close()
// The list, captioned, in order, beside the shots.
if (only.length === 0)
  writeFileSync(resolve(out, 'README.md'), `${shots.map((one) => `- **${one.id}** ${one.caption} (\`${one.id}.png\`)`).join('\n')}\n`)
