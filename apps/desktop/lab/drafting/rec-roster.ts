// Records Roster (take 5) at real pace into lab/drafting/shots: its opening, the seats being chosen, and the plan arriving. Lab on 6133; run from apps/desktop, outside an agent's sandbox.
import { join } from 'node:path'
import { chromium } from '@playwright/test'
const out = join(import.meta.dirname, 'shots')
const browser = await chromium.launch()
const rec = async (name: string, from: number, ms: number) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 760 },
    recordVideo: { dir: out, size: { width: 820, height: 760 } },
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => process.stderr.write(`page error: ${e.message}\n`))
  await page.goto(`http://localhost:6133/?d=5&speed=1&from=${from}`)
  await page.waitForTimeout(ms)
  const b = (await page.locator('[data-ready]').first().boundingBox())!
  process.stdout.write(`${name} ${Math.round(b.x)} ${Math.round(b.y)} ${Math.round(b.width)} ${Math.round(b.height)}\n`)
  await context.close()
  await page.video()?.saveAs(join(out, `${name}.webm`))
}
await rec('m-start', 0, 2500)
await rec('m-ready', 26500, 3500)
await rec('m-choose', 16500, 9000)
await rec('m-open', 0, 5000)
await browser.close()
process.stdout.write('ok\n')
