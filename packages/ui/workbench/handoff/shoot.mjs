// Shoots the handoff stories, light and dark, at 1×, into the folder given (test-results/handoff by default),
// from a Storybook on the port given: node packages/ui/workbench/handoff/shoot.mjs 6163 [out]
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(join(import.meta.dirname, '../../../../apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const port = process.argv[2] ?? '6163'
const out = process.argv[3] ?? join(import.meta.dirname, '../../test-results/handoff')
mkdirSync(out, { recursive: true })
const stories = [
  'choosing-roles',
  'switching-lens',
  'spec-draft',
  'spec-pull-request',
  'handoff',
  'handoff-accepted',
  'asking-back',
  'asked-waiting',
  'product-answers',
  'answered',
  'feature-page',
  'design-lens',
]
const browser = await chromium.launch()
for (const story of stories)
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1560, height: 940 }, deviceScaleFactor: 1 })
    await page.goto(`http://127.0.0.1:${port}/iframe.html?id=workbench-handoff--${story}&viewMode=story&globals=theme:${theme}`)
    await page.waitForSelector('#storybook-root > *', { state: 'attached', timeout: 120_000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(out, `${story}-${theme}.png`) })
    await page.close()
  }
await browser.close()
