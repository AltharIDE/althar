// Scrappy: every shot, small, on one contact sheet, to check them at a glance: node sheet.mjs [id…]
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import shots from './shots.json' with { type: 'json' }

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const dir = resolve(repo, '.althar/scratch/project-settings/shots')
const only = process.argv.slice(2)
const cells = shots
  .filter((one) => only.length === 0 || only.includes(one.id))
  .map((one) => {
    const src = `data:image/png;base64,${readFileSync(resolve(dir, `${one.id}.png`)).toString('base64')}`
    return `<figure><img src="${src}"><figcaption><b>${one.id}</b></figcaption></figure>`
  })
const html = `<style>body{margin:0;font:12px system-ui;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px;width:1440px;box-sizing:border-box}figure{margin:0}img{width:100%;display:block;border:1px solid #ccc}</style>${cells.join('')}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 400 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.screenshot({ path: resolve(repo, '.althar/scratch/project-settings/sheet.png'), fullPage: true })
await browser.close()
