// Scrappy: every shot in shots.json, headless, at 1x, into shots/ (git ignores it): node shoot.mjs [id…]. The server must be up (see README).
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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ...(shot.reduce ? { reducedMotion: 'reduce' } : {}),
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://localhost:5397/${shot.page}`)
  // Long enough for the page to open, send, and get to the moment it holds (or, unheld, to run on to it).
  await page.waitForTimeout(shot.wait ?? 4500)
  // A shot's clip, [x, y, width, height], keeps it to the part it is about.
  const clip = shot.clip === undefined ? {} : { clip: { x: shot.clip[0], y: shot.clip[1], width: shot.clip[2], height: shot.clip[3] } }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`), ...clip })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
const list = shots.filter((one) => only.length === 0 || only.includes(one.id))
// A few at once: the machine is shared.
for (let at = 0; at < list.length; at += 3) await Promise.all(list.slice(at, at + 3).map(shoot))
await browser.close()
// The list, captioned, in order, beside the shots.
if (only.length === 0)
  writeFileSync(resolve(out, 'README.md'), `${shots.map((one) => `- **${one.id}** ${one.caption} (\`${one.id}.png\`)`).join('\n')}\n`)
