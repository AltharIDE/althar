// Scrappy: every case in every direction, on the task and the board, headless: says any page error, and how each reads.
// node walk.mjs [case…]   (outside the sandbox: Chromium can't start in it)
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const cases = readFileSync(resolve(import.meta.dirname, 'cases.ts'), 'utf8').match(/key: '([a-z-]+)'/g).map((one) => one.slice(6, -1))
const only = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
let errors = []
page.on('pageerror', (error) => errors.push(String(error).split('\n')[0]))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text().split('\n')[0]))
let bad = 0
for (const key of cases.filter((one) => only.length === 0 || only.includes(one))) {
  for (const d of ['A', 'B', 'C']) {
    for (const where of ['threads/th1', 'projects/p1?room=board']) {
      errors = []
      await page.goto(`http://localhost:5374/?d=${d}&s=${key}&bare#/${where}`)
      await page.waitForTimeout(450)
      const chip = where.startsWith('threads') ? await page.locator('header[aria-label] span[data-status]').first().innerText().catch(() => '—') : ''
      if (errors.length > 0) bad += 1
      process.stdout.write(`${key} ${d} ${where.startsWith('threads') ? 'task ' : 'board'} ${errors.length === 0 ? 'ok' : `ERR ${[...new Set(errors)].join(' | ')}`}${chip === '' ? '' : `  [${chip.replace(/\n/g, ' ')}]`}\n`)
    }
  }
}
await browser.close()
process.stdout.write(`${bad} with errors\n`)
