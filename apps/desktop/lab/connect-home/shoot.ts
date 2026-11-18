import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * Shoots each scene of the Connect a home lab (README.md), headless, at 1×, light and dark, into lab/connect-home/shots:
 *
 *   node lab/connect-home/shoot.ts <name> [scene…]
 *
 * With the lab running (Connect a home lab, on port 6141).
 */

const [name = 'shot', ...asked] = process.argv.slice(2)
const scenes =
  asked.length > 0
    ? asked
    : [
        'ssh',
        'ssh-options',
        'ssh-checking',
        'ssh-refused',
        'ssh-checked',
        'ssh-connecting',
        'ssh-failed',
        'pair',
        'pair-checked',
        'pair-refused',
        'pair-pairing',
      ]
const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
for (const theme of ['light', 'dark'])
  for (const scene of scenes) {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => console.error(`${scene}:`, error.message))
    await page.goto(`http://localhost:${process.env.LAB_PORT ?? '6141'}/?scene=${scene}&theme=${theme}`)
    await page.waitForSelector('body[data-driven]')
    await page.waitForTimeout(500)
    await page.getByRole('dialog').screenshot({ path: join(out, `${name}-${scene}-${theme}.png`) })
    await page.close()
  }
// A sheet of each appearance's scenes, side by side, for looking at them all at once.
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 400 }, deviceScaleFactor: 1 })
  const cells = scenes
    .map((scene) => {
      const data = readFileSync(join(out, `${name}-${scene}-${theme}.png`)).toString('base64')
      return `<figure><figcaption>${scene}</figcaption><img src="data:image/png;base64,${data}"></figure>`
    })
    .join('')
  await page.setContent(
    `<style>body{margin:0;padding:16px;background:${theme === 'dark' ? '#222' : '#ddd'};font:12px sans-serif;color:${theme === 'dark' ? '#eee' : '#222'};display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}figure{margin:0}img{display:block;width:400px}</style>${cells}`,
  )
  await page.screenshot({ path: join(out, `${name}-sheet-${theme}.png`), fullPage: true })
  await page.close()
}
await browser.close()
process.stdout.write(`${scenes.length * 2} shots in ${out}\n`)
