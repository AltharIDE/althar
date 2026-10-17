// Scrappy: shots side by side on one sheet, each with its caption, at 1x: node sheet.mjs out.png columns 'file.png|caption' …
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../package.json'))
const { chromium } = require('@playwright/test')

const [out, columns, ...pairs] = process.argv.slice(2)
const cells = pairs
  .map((pair) => {
    const [file, caption = ''] = pair.split('|')
    const data = readFileSync(resolve(import.meta.dirname, file)).toString('base64')
    return `<figure><figcaption>${caption}</figcaption><img src="data:image/png;base64,${data}"></figure>`
  })
  .join('')
const html = `<html><body style="margin:0;background:#dcd8cd;font:12px Inter,system-ui;color:#45454c">
<div style="display:grid;grid-template-columns:repeat(${columns},max-content);gap:10px;padding:10px">${cells}</div>
<style>figure{margin:0;display:grid;gap:4px}img{display:block;box-shadow:0 0 0 1px rgba(0,0,0,.12)}figcaption{font-weight:600}</style></body></html>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.waitForTimeout(200)
await page.screenshot({ path: resolve(import.meta.dirname, out), fullPage: true })
await browser.close()
