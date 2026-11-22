// Lays shots side by side, two across at half size, into one picture, for looking over several at once:
// node lab/phone-pairing/sheet.mjs out-name a-3 a-5 … (names from shots/, by their start). Run outside the sandbox.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const shots = join(import.meta.dirname, 'shots')
const [name, ...wanted] = process.argv.slice(2)
const files = readdirSync(shots)
  .filter((file) => file.endsWith('.png') && wanted.some((one) => file.startsWith(one)))
  .sort((a, b) => wanted.findIndex((one) => a.startsWith(one)) - wanted.findIndex((one) => b.startsWith(one)))
const cells = files
  .map(
    (file) =>
      `<figure><img src="data:image/png;base64,${readFileSync(join(shots, file)).toString('base64')}"><figcaption>${file}</figcaption></figure>`,
  )
  .join('')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1290, height: 400 }, deviceScaleFactor: 1 })
await page.setContent(
  `<style>body{margin:0;background:#888;display:grid;grid-template-columns:repeat(2,640px);gap:6px 10px;padding:0}figure{margin:0}img{width:640px;display:block}figcaption{font:11px sans-serif;color:#fff;padding:2px}</style>${cells}`,
)
await page.screenshot({ path: join(shots, `sheet-${name}.png`), fullPage: true })
await browser.close()
