// Scrappy: the new directions' peeks and pickers, as the person would use them, each check printed ok or FAILED: All models' readings per model (shot into shots/), C's lead opening in place, a peek closing on Escape and on a click outside, and switching direction with a peek open. node check.mjs, the server up, outside the agent sandbox.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(resolve(import.meta.dirname, '../../package.json'))
const { chromium } = require('@playwright/test')

const out = resolve(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
let failed = 0

const open = async (query) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-GB' })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://localhost:5441/${query}`, { timeout: 90_000 })
  await page.waitForTimeout(2500)
  return { page, errors }
}
const check = async (name, run) => {
  try {
    const said = await run()
    process.stdout.write(`ok      ${name}${said ? `: ${said}` : ''}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`FAILED  ${name}: ${String(error).split('\n')[0]}\n`)
  }
}
const expect = (truth, what) => {
  if (!truth) throw new Error(what)
}

// All models: each row says its own model's route.
for (const d of ['A', 'B', 'C']) {
  await check(`${d} · All models says each model's reading`, async () => {
    const { page, errors } = await open(`?d=${d}&s=nearly&silent=1&v=picker`)
    await page.getByRole('button', { name: /All models/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    await page.waitForTimeout(500)
    const rows = await dialog.locator('li[data-id]').evaluateAll((items) =>
      items.map((item) => {
        const note = item.querySelector('[data-usage]')
        return `${item.dataset.id} → ${note?.textContent ?? '(none)'}${note?.getAttribute('title') ? ` (hover: ${note.getAttribute('title')})` : ''}`
      }),
    )
    await page.screenshot({ path: resolve(out, `${d.toLowerCase()}-browser.png`), clip: { x: 200, y: 90, width: 880, height: 520 } })
    expect(errors.length === 0, errors.join(' | '))
    const codex = rows.find((row) => row.startsWith('codex:gpt-5.5 '))
    // Opus counts its own week (19% left); Sonnet doesn't (56%).
    const opus = rows.find((row) => row.startsWith('claude-code:opus '))
    const sonnet = rows.find((row) => row.startsWith('claude-code:sonnet '))
    expect(opus?.includes('19%') && !sonnet?.includes('19%'), `opus ${opus}, sonnet ${sonnet}`)
    // The figure alone in a row, so the model's name keeps its room; until when on hover.
    expect(
      codex?.includes(d === 'C' ? '→ 3% left (hover: 3% left · until 14:00)' : '→ 3% (hover: 3% · until 14:00)'),
      `codex row: ${codex}`,
    )
    await page.close()
    return rows.join('; ')
  })
}

await check('C · the lead opens in place to its accounts and windows', async () => {
  const { page } = await open('?d=C&s=nearly&silent=1&v=board&u=1')
  const peek = page.getByRole('dialog', { name: 'Plan usage' })
  await peek.waitFor()
  const lead = peek.locator('button[aria-expanded]').first()
  await lead.click()
  await page.waitForTimeout(300)
  const text = await peek.innerText()
  expect((await lead.getAttribute('aria-expanded')) === 'true', 'not expanded')
  expect(text.includes('5 hours') && text.includes('Week'), `no windows: ${text}`)
  await page.screenshot({ path: resolve(out, 'c-peek-lead-open.png'), clip: { x: 640, y: 0, width: 440, height: 440 } })
  await page.close()
  return 'Codex opened: 5 hours, Week'
})

for (const [d, name] of [
  ['A', 'Plan usage'],
  ['B', 'This Mac’s load and plan usage'],
  ['C', 'Plan usage'],
]) {
  await check(`${d} · ⌘U opens the peek, Escape closes it, a click opens it, a click outside closes it`, async () => {
    const { page } = await open(`?d=${d}&s=nearly&v=board&u=1`)
    const peek = page.getByRole('dialog', { name })
    await peek.waitFor()
    await page.keyboard.press('Escape')
    await peek.waitFor({ state: 'detached', timeout: 3000 })
    await page.getByRole('button', { name: /Plan usage:/ }).click()
    await peek.waitFor()
    // Well clear of every peek: B's reaches further left and down than the others.
    await page.mouse.click(150, 650)
    await peek.waitFor({ state: 'detached', timeout: 3000 })
    await page.keyboard.press('Meta+u')
    await peek.waitFor({ timeout: 3000 })
    await page.close()
    return 'open, closed, open, closed, open'
  })
}

await check('Switching A → C with the peek open leaves no peek behind, and ⌘U opens C’s', async () => {
  const { page } = await open('?d=A&s=nearly&v=board&u=1')
  await page.getByRole('dialog', { name: 'Plan usage' }).waitFor()
  await page.getByRole('radio', { name: /Tightest first/ }).click({ force: true })
  await page.waitForTimeout(600)
  const left = await page.getByRole('dialog').count()
  const figure = await page.getByRole('button', { name: /Plan usage:/ }).innerText()
  expect(/codex/i.test(figure), `C's figure: ${figure}`)
  if (left > 0) {
    // ⌘U's state carried over: the person sees C's own peek, not A's.
    const text = await page.getByRole('dialog').innerText()
    expect(text.includes('3%') && !text.includes('Plenty left'), `peek after switching: ${text}`)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Meta+u')
  const text = await page.getByRole('dialog', { name: 'Plan usage' }).innerText({ timeout: 3000 })
  expect(text.startsWith('3%'), `C's peek: ${text}`)
  await page.close()
  return `bar reads “${figure.replace(/\s+/g, ' ')}”; ${left === 0 ? 'peek closed on switching' : 'C’s own peek shown'}`
})

await browser.close()
process.stdout.write(failed === 0 ? 'all passed\n' : `${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
