// Records the pill opening, folding, and turning back mid-way into shots/<name>.webm: node record.mjs <name> <query> [handoff] (the lab must be running on 6143).
// With handoff: the pill opens, then the run chip (or the goal, in a task) opens and folds it, then the pill opens again and closes that.
import { mkdirSync, renameSync } from 'node:fs'
import { chromium } from '../../../../node_modules/.bun/playwright@1.65.1/node_modules/playwright/index.mjs'

const [name = 'morph', query = 'd=pill&m=back&w=coordinator', mode = 'morph'] = process.argv.slice(2)
const out = new URL('./shots/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const size = { width: 1000, height: 720 }
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: out, size } })
const page = await context.newPage()
await page.goto(`http://localhost:6143/?${query}&open=0`)
await page.waitForTimeout(900)
const pill = () => page.locator('button[aria-expanded="false"][aria-label^="Merging"]')
const head = () => page.locator('section[aria-label="Merging"] button[aria-expanded="true"]')
if (mode === 'handoff') {
  const other = query.includes('w=task')
    ? page.locator('button[aria-expanded]', { hasText: 'Get every runtime test' })
    : page.getByRole('button', { name: /Site dev server/ })
  await pill().click()
  await page.waitForTimeout(1200)
  await other.click()
  await page.waitForTimeout(1400)
  await pill().click()
  await page.waitForTimeout(1400)
} else {
  await pill().click()
  await page.waitForTimeout(1100)
  await head().click()
  await page.waitForTimeout(1100)
  // Opened, then folded again before it lands: it turns back from where it is.
  await pill().click()
  await page.waitForTimeout(150)
  await head().click()
  await page.waitForTimeout(1100)
}
const video = page.video()
await context.close()
renameSync(await video.path(), `${out}${name}.webm`)
await browser.close()
