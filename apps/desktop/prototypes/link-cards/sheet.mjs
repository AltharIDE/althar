// Scrappy: a few shots on one sheet, to look over them: node sheet.mjs out.png A1 A2 A3 A4
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const [out, ...ids] = process.argv.slice(2)
const shots = resolve(repo, '.althar/scratch/link-cards/shots')
const cells = ids
  .map((id) => {
    const data = readFileSync(resolve(shots, `${id}.png`)).toString('base64')
    return `<figure><img src="data:image/png;base64,${data}"><figcaption>${id}</figcaption></figure>`
  })
  .join('')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1 })
await page.setContent(
  `<style>body{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#888;font:12px sans-serif}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:4px;top:4px;background:#000;color:#fff;padding:1px 4px}</style>${cells}`,
)
await page.screenshot({ path: resolve(out), fullPage: true })
await browser.close()
