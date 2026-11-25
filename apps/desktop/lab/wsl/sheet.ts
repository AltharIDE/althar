import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

/*
 * A sheet of shots at half size, two to a row, captioned with their names:
 *
 *   node lab/wsl/sheet.ts <out.png> <prefix…>      # e.g. sheet-1.png 1- 2-  (light shots whose names start so)
 */

const [file = 'sheet.png', ...prefixes] = process.argv.slice(2)
const dir = join(import.meta.dirname, 'shots')
const theme = process.env.THEME ?? 'light'
const shots = readdirSync(dir)
  .filter((name) => name.endsWith(`-${theme}.png`) && prefixes.some((prefix) => name.startsWith(prefix)))
  .sort()
const cells = shots
  .map(
    (name) =>
      `<figure><figcaption>${name}</figcaption><img src="data:image/png;base64,${readFileSync(join(dir, name)).toString('base64')}"></figure>`,
  )
  .join('')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 400 }, deviceScaleFactor: 1 })
await page.setContent(
  `<style>body{margin:0;padding:10px;font:12px system-ui;background:#ddd;display:grid;grid-template-columns:repeat(2,640px);gap:10px}figure{margin:0}figcaption{padding:2px 0}img{width:640px;display:block}</style>${cells}`,
)
await page.screenshot({ path: join(dir, file), fullPage: true })
await browser.close()
process.stdout.write(`${shots.length} shots in ${file}\n`)
