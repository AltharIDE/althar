// Shoots Roster (take 5): the plan, assembling, a row hovered, and each dropdown opened by a click away from the row's start. Lab on 6133; run from apps/desktop, outside an agent's sandbox.
import { join } from 'node:path'
import { chromium } from '@playwright/test'
const out = join(process.cwd(), 'lab/drafting/shots')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 820, height: 760 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto('http://localhost:6133/?d=5&at=29000')
await page.waitForTimeout(900)
const card = page.locator('[data-ready]').first()
await card.screenshot({ path: join(out, 'r-plan.png') })
await page.goto('http://localhost:6133/?d=5&at=20500')
await page.waitForTimeout(900)
await card.screenshot({ path: join(out, 'r-assembling.png') })
await page.goto('http://localhost:6133/?d=5&at=29000')
await page.waitForTimeout(900)
const lead = page.getByRole('button', { name: /Lead for this task/ })
const box = (await lead.boundingBox())!
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(300)
await card.screenshot({ path: join(out, 'r-hover.png') })
await page.mouse.click(box.x + box.width - 40, box.y + box.height / 2)
await page.waitForTimeout(400)
const c = (await card.boundingBox())!
await page.screenshot({ path: join(out, 'r-open-right.png'), clip: { x: c.x, y: c.y, width: c.width, height: 560 } })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const end = page.getByRole('button', { name: /When the work is done/ })
const eb = (await end.boundingBox())!
await page.mouse.click(eb.x + 200, eb.y + eb.height / 2)
await page.waitForTimeout(400)
await page.screenshot({ path: join(out, 'r-open-end.png'), clip: { x: c.x, y: c.y, width: c.width, height: 620 } })
process.stdout.write('ok\n')
await browser.close()
