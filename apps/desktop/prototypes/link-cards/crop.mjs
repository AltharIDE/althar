// Scrappy: a piece of a shot, to look closely: node crop.mjs ID x y width height (in the page's pixels; shots are at 2x)
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const [id, x, y, width, height] = process.argv.slice(2)
const scratch = resolve(repo, '.althar/scratch/link-cards')
mkdirSync(resolve(scratch, 'crops'), { recursive: true })
const data = readFileSync(resolve(scratch, 'shots', `${id}.png`)).toString('base64')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await page.setContent(`<style>body{margin:0}img{width:1440px;display:block}</style><img src="data:image/png;base64,${data}">`)
await page.screenshot({ path: resolve(scratch, 'crops', `${id}.png`), clip: { x: +x, y: +y, width: +width, height: +height } })
await browser.close()
