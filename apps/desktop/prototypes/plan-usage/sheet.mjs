// Scrappy: shots side by side on one sheet, under a title, each numbered and captioned, at 1x: node sheet.mjs out.png columns 'title' 'file.png|caption' …, or --shots <prefix> for every shot in shots.json whose id starts so, in its order.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../package.json'))
const { chromium } = require('@playwright/test')

const [out, columns, title, ...given] = process.argv.slice(2)
const listed = JSON.parse(readFileSync(resolve(import.meta.dirname, 'shots.json'), 'utf8'))
const pairs =
  given[0] === '--shots'
    ? listed.filter((shot) => shot.id.startsWith(given[1])).map((shot) => `shots/${shot.id}.png|${shot.caption}`)
    : given
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const cells = pairs
  .map((pair, index) => {
    const [file, caption = ''] = pair.split('|')
    const data = readFileSync(resolve(import.meta.dirname, file)).toString('base64')
    return `<figure><img src="data:image/png;base64,${data}"><figcaption><b>${index + 1}</b> ${escape(caption)}</figcaption></figure>`
  })
  .join('')
const html = `<html><body style="margin:0;background:#dcd8cd;font:12.5px/1.4 Inter,system-ui;color:#45454c">
<h1 style="margin:0;padding:14px 12px 2px;font-size:16px;color:#141417">${escape(title)}</h1>
<div style="display:grid;grid-template-columns:repeat(${columns},max-content);gap:14px 12px;padding:10px 12px 14px;align-items:start">${cells}</div>
<style>figure{margin:0;display:grid;gap:6px;grid-template-rows:auto auto}img{display:block;box-shadow:0 0 0 1px rgba(0,0,0,.12)}
figcaption{width:0;min-width:100%;text-wrap:pretty}figcaption b{color:#141417}</style></body></html>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.waitForTimeout(200)
await page.screenshot({ path: resolve(import.meta.dirname, out), fullPage: true })
await browser.close()
