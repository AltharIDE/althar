// Scrappy: shots side by side on one sheet, to look them over: node sheet.mjs out.png A1 A2 A3 A4
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')
const [out, ...ids] = process.argv.slice(2)
const shots = resolve(repo, '.althar/scratch/browser/shots')
const cells = ids
  .map(
    (id) =>
      `<figure><img src="data:image/png;base64,${readFileSync(resolve(shots, `${id}.png`)).toString('base64')}"><figcaption>${id}</figcaption></figure>`,
  )
  .join('')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 1 })
await page.setContent(
  `<style>body{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:2px;background:#888;font:12px sans-serif}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:4px;top:4px;background:#000;color:#fff;padding:1px 4px}</style>${cells}`,
)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
