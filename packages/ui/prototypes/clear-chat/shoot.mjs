// Scrappy: each direction clicked through, headless at 1×, into the task's scratch folder: node shoot.mjs [id…]
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(resolve(repo, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

const out = resolve(repo, '.althar/scratch/clear-chat')
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)

const button = (page, name) => page.getByRole('button', { name }).first().click()
const exact = (page, name) => page.getByRole('button', { name, exact: true }).first().click()
const say = async (page, words) => {
  const field = page.locator('[contenteditable=true], textarea').first()
  await field.click()
  await field.fill(words)
  await field.press('Enter')
  await page.waitForTimeout(2700)
}
/** The ring's detail, open while the pointer rests on it. */
const ring = async (page) => {
  await page.getByRole('button', { name: /Context \d+% used/ }).hover()
  await page.waitForTimeout(600)
}
/** The clear, from wherever the direction puts it, and the kind chosen. */
const clear = async (page, direction, kind) => {
  if (direction === 'C') await ring(page)
  await (direction === 'C' ? page.getByRole('button', { name: 'Clear chat…' }).click() : exact(page, 'Clear'))
  await page.waitForTimeout(500)
  if (kind === 'forget') {
    await page.getByRole('radio', { name: /Forget it too/ }).click()
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'Clear and forget' }).click()
  } else {
    await page.getByRole('radio', { name: /Keep what the coordinator knows/ }).click()
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'Clear the view' }).click()
  }
  await page.waitForTimeout(900)
}
/** Off the controls, so no tooltip or open ring stands over what was done. */
const settle = async (page) => {
  await page.keyboard.press('Escape')
  await page.mouse.move(20, 300)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.waitForTimeout(700)
}

const shots = [
  // The conversation as built.
  { id: '0-today', d: 'Today' },

  // A: the clear in the composer, beside the model, and /clear in the field.
  { id: 'a1-composer', d: 'A' },
  {
    id: 'a2-dialog',
    d: 'A',
    settle: false,
    go: async (page) => {
      await exact(page, 'Clear')
      await page.waitForTimeout(500)
    },
  },
  { id: 'a3-cleared', d: 'A', go: (page) => clear(page, 'A', 'view') },
  { id: 'a4-forgot', d: 'A', go: (page) => clear(page, 'A', 'forget') },

  // B: a conversation bar above the thread, with Clear in it.
  { id: 'b1-head', d: 'B' },
  { id: 'b2-cleared', d: 'B', go: (page) => clear(page, 'B', 'view') },
  {
    id: 'b3-earlier',
    d: 'B',
    go: async (page) => {
      await clear(page, 'B', 'view')
      await button(page, 'Show earlier')
      await page.waitForTimeout(700)
    },
  },
  { id: 'b4-forgot', d: 'B', go: (page) => clear(page, 'B', 'forget') },

  // C: the clear in the context ring's foot, beside Compact.
  { id: 'c1-ring', d: 'C', go: (page) => ring(page), settle: false },
  {
    id: 'c2-dialog',
    d: 'C',
    settle: false,
    go: async (page) => {
      await ring(page)
      await page.getByRole('button', { name: 'Clear chat…' }).click()
      await page.waitForTimeout(500)
    },
  },
  {
    id: 'c3-cleared',
    d: 'C',
    go: async (page) => {
      await clear(page, 'C', 'view')
      await settle(page)
    },
  },
  { id: 'c4-forgot', d: 'C', go: (page) => clear(page, 'C', 'forget') },

  // The one question, and what the coordinator says after each kind.
  {
    id: 'd1-forget-dialog',
    d: 'B',
    settle: false,
    go: async (page) => {
      await exact(page, 'Clear')
      await page.waitForTimeout(500)
      await page.getByRole('radio', { name: /Forget it too/ }).click()
      await page.waitForTimeout(300)
    },
  },
  {
    id: 'd2-answer',
    d: 'B',
    go: async (page) => {
      await clear(page, 'B', 'view')
      await say(page, 'Where were we?')
    },
  },
  {
    id: 'd3-fresh',
    d: 'B',
    go: async (page) => {
      await clear(page, 'B', 'forget')
      await say(page, 'Where were we?')
    },
  },

  // In a narrow window, each placement keeps its label.
  { id: 'n1-a-narrow', d: 'A', width: 780, height: 760 },
  { id: 'n2-b-narrow', d: 'B', width: 780, height: 760 },
  { id: 'n3-c-narrow', d: 'C', width: 780, height: 760 },
]

const browser = await chromium.launch()
for (const shot of shots.filter((one) => only.length === 0 || only.includes(one.id))) {
  const page = await browser.newPage({
    viewport: { width: shot.width ?? 1280, height: shot.height ?? 860 },
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300))
  })
  await page.goto(`http://localhost:5363/?d=${shot.d}&bare#/projects/p1?room=both`)
  await page.waitForTimeout(1500)
  try {
    await shot.go?.(page)
    if (shot.settle !== false) await settle(page)
  } catch (error) {
    errors.push(String(error).split('\n')[0])
  }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`) })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
await browser.close()
