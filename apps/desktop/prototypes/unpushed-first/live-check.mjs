import { chromium } from '@playwright/test'
const out = process.argv[2]
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 })
p.on('pageerror', (e) => console.error('pageerror', e.message))
for (const d of ['a', 'e']) {
  await p.goto(`http://localhost:5344/screen.html?d=${d}&live`)
  await p.waitForTimeout(800)
  const button = d === 'a' ? p.getByRole('button', { name: 'Push 3 commits' }) : p.getByRole('button', { name: '3 to push' })
  await button.click()
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${out}/live-${d}-1-pushing.png` })
  await p.waitForTimeout(1800)
  await p.screenshot({ path: `${out}/live-${d}-2-pushed.png` })
  console.error(d, 'ok')
}
await b.close()
