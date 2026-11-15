import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Records how A and C move, as GIFs, into apps/site/test-results/gallery/,
 * with the site's dev server running on 5320 and ffmpeg on the PATH. Run it
 * outside an agent's sandbox, from apps/site: node src/home/gallery/record.mjs
 */

const out = join(import.meta.dirname, '../../../test-results/gallery')
const tmp = join(out, 'video')
mkdirSync(tmp, { recursive: true })
const browser = await chromium.launch()

const record = async (name, query, seconds) => {
  const size = { width: 1280, height: 900 }
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: tmp, size } })
  const page = await context.newPage()
  await page.goto(`http://localhost:5320/gallery?${query}&shot`)
  await page.waitForSelector('#gallery')
  await page.addStyleTag({ content: '[class*="Nav-module__"], .skip { visibility: hidden !important; }' })
  await page.evaluate(() => {
    const stage = document.getElementById('gallery-panel')
    window.scrollTo({ top: stage.getBoundingClientRect().top + window.scrollY - 24, behavior: 'instant' })
  })
  await page.waitForTimeout(seconds * 1000)
  await context.close()
  const [video] = readdirSync(tmp).filter((f) => f.endsWith('.webm'))
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    '1.2',
    '-i',
    join(tmp, video),
    '-vf',
    'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    join(out, `${name}.gif`),
  ])
  rmSync(join(tmp, video))
}

await record('a-tabs-moving', 'd=a', 15)
await record('c-film-moving', 'd=c', 22)
await browser.close()
rmSync(tmp, { recursive: true, force: true })
