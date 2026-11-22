// Shoots each direction's states, light and dark, at 1×, the app's window only, into lab/role-lenses/shots (the lab
// running on 6181): node lab/role-lenses/shoot.mjs, from apps/desktop.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const states = [
  ['engineering', 'role=engineering'],
  ['devops', 'role=devops'],
  ['timeline', 'role=devops&feature=saved-carts'],
  ['switch', 'role=devops&menu=1'],
]
for (const d of ['a', 'b', 'c'])
  for (const theme of ['light', 'dark'])
    for (const [name, query] of states) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
      await page.goto(`http://localhost:6181/?d=${d}&${query}&theme=${theme}`)
      await page.waitForTimeout(1400)
      await page.locator('[data-lab-window]').screenshot({ path: join(out, `${d}-${name}-${theme}.png`) })
      await page.close()
    }
await browser.close()
