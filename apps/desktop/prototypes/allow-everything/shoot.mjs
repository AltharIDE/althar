// Scrappy: every shot in shots.json, headless, into shots/ (git ignores it): node shoot.mjs [id…]. The server must be up (see README).
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://localhost:5361/${shot.page}`)
  await page.waitForTimeout(2500)
  for (const step of shot.steps ?? []) {
    if (step.startsWith('wait:')) await page.waitForTimeout(Number(step.slice(5)))
    else if (step.startsWith('key:')) await page.keyboard.press(step.slice(4))
    else await page.locator(step).first().click()
    await page.waitForTimeout(500)
  }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`) })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
const list = shots.filter((one) => only.length === 0 || only.includes(one.id))
// A few at once: the machine is busy.
for (let at = 0; at < list.length; at += 4) await Promise.all(list.slice(at, at + 4).map(shoot))
await browser.close()
// The list, captioned, in order, beside the shots.
writeFileSync(resolve(out, 'README.md'), `${shots.map((one) => `- **${one.id}** ${one.caption} (\`${one.id}.png\`)`).join('\n')}\n`)
