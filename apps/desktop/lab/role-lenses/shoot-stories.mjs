// Shoots the role-lenses stories (packages/ui/workbench/role-lenses), light and dark, at 1×, into
// lab/role-lenses/shots/stories, from a Storybook on the port given (6151 by default): node lab/role-lenses/shoot-stories.mjs 6151
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const port = process.argv[2] ?? '6151'
const out = join(import.meta.dirname, 'shots', 'stories')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const directions = ['a-minimal', 'b-panels', 'c-feature-first']
const stories = ['product-home', 'design-home', 'engineering-home', 'dev-ops-home', 'feature-timeline', 'lens-switch']
for (const d of directions)
  for (const story of stories)
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
      await page.goto(`http://127.0.0.1:${port}/iframe.html?id=workbench-role-lenses-${d}--${story}&viewMode=story&globals=theme:${theme}`)
      await page.waitForSelector('#storybook-root > *', { state: 'attached', timeout: 120_000 })
      await page.waitForTimeout(1200)
      await page.screenshot({ path: join(out, `${d}-${story}-${theme}.png`) })
      await page.close()
    }
await browser.close()
