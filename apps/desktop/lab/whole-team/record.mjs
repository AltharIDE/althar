// Records C as a GIF, with the lab running on 6181: Ana's board, Look and approve on Maya's ask, the app on main and
// with the change flipped between, then Approve and merge. Into lab/whole-team/shots/c-approve.gif, through ffmpeg.
// Chromium can't start in an agent's sandbox on a Mac; run it outside: node lab/whole-team/record.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
const video = join(out, 'video')
rmSync(video, { recursive: true, force: true })
mkdirSync(video, { recursive: true })
const size = { width: 1360, height: 820 }

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: video, size } })
const page = await context.newPage()
await page.goto('http://localhost:6181/?d=c&m=0')
await page.waitForTimeout(2500)
await page.getByRole('button', { name: 'Look and approve' }).click()
await page.waitForTimeout(3000)
for (const side of ['On main', 'With Maya’s change', 'On main', 'With Maya’s change']) {
  await page.getByRole('radio', { name: side }).click()
  await page.waitForTimeout(1300)
}
await page.getByRole('button', { name: 'Approve and merge' }).click()
await page.waitForTimeout(2500)
await context.close()
await browser.close()

const [recorded] = readdirSync(video).filter((name) => name.endsWith('.webm'))
const gif = join(out, 'c-approve.gif')
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-ss',
  '1.5',
  '-i',
  join(video, String(recorded)),
  '-vf',
  'fps=8,scale=1020:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer',
  gif,
])
process.stdout.write(`${gif}\n`)
