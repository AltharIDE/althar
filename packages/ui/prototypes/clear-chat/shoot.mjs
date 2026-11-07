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

/* ——— What the person does, as clicks. ——— */
const button = (page, name) => page.getByRole('button', { name }).first().click()
const exact = (page, name) => page.getByRole('button', { name, exact: true }).first().click()
const menu = (page, name) => page.getByRole('menuitem', { name }).first().click()
const more = (page) => button(page, 'More for this project')
const knows = (page) => button(page, 'What it knows')
const say = async (page, words) => {
  const field = page.locator('[contenteditable=true], textarea').first()
  await field.click()
  await field.fill(words)
  await field.press('Enter')
  await page.waitForTimeout(2700)
}
/** The project's settings, at its notes, as the person opens them: from its views, then down the side. */
const notes = async (page) => {
  await page.getByRole('radio', { name: 'Settings' }).click()
  await page.waitForTimeout(400)
  await page.getByText('Notes', { exact: true }).first().click()
  await page.waitForTimeout(400)
}
/** Back at the top of the conversation: the place a clear puts the view. */
const toTop = (page) =>
  page.evaluate(() => {
    const thread = document.querySelector('section[aria-label="Conversation"]')
    for (let box = thread?.parentElement ?? null; box !== null; box = box.parentElement)
      if (/(auto|scroll)/.test(getComputedStyle(box).overflowY)) {
        box.scrollTop = 0
        break
      }
  })

const shots = [
  // The conversation as built.
  { id: '0-today', d: 'Today' },

  // B: the brief is the memory; the thread is disposable.
  { id: 'b1-knows', d: 'B', go: (page) => knows(page) },
  { id: 'b2-new', d: 'B', go: (page) => button(page, 'New chat') },
  {
    id: 'b3-answer',
    d: 'B',
    go: async (page) => {
      await button(page, 'New chat')
      await say(page, 'Where were we?')
    },
  },
  {
    id: 'b4-earlier',
    d: 'B',
    go: async (page) => {
      await button(page, 'New chat')
      await page.waitForTimeout(500)
      await exact(page, 'Read')
    },
  },
  {
    id: 'b5-one-line',
    d: 'B',
    go: async (page) => {
      await knows(page)
      await page.getByRole('button', { name: /Forget: You asked me/ }).click()
    },
  },
  {
    id: 'b6-forget',
    d: 'B',
    go: async (page) => {
      await knows(page)
      await button(page, 'Forget everything…')
    },
  },
  {
    id: 'b7-forgotten',
    d: 'B',
    go: async (page) => {
      await knows(page)
      await button(page, 'Forget everything…')
      await exact(page, 'Forget it')
    },
  },

  // A: a page opens with the coordinator's handover; the pages before stay.
  { id: 'a1-new', d: 'A', go: (page) => button(page, 'New page') },
  {
    id: 'a2-old',
    d: 'A',
    go: async (page) => {
      await button(page, 'New page')
      await page.waitForTimeout(500)
      await page.getByRole('button', { name: /Read page 1/ }).click()
    },
  },
  {
    id: 'a3-answer',
    d: 'A',
    go: async (page) => {
      await button(page, 'New page')
      await page.waitForTimeout(500)
      await say(page, 'Where were we?')
    },
  },
  {
    id: 'a4-forget',
    d: 'A',
    go: async (page) => {
      await more(page)
      await menu(page, 'Forget everything…')
    },
  },
  {
    id: 'a5-forgotten',
    d: 'A',
    go: async (page) => {
      await more(page)
      await menu(page, 'Forget everything…')
      await exact(page, 'Forget it')
      await page.waitForTimeout(500)
      await toTop(page)
    },
  },

  // C: focus is a view; the session and the thread are untouched.
  {
    id: 'c1-focus',
    d: 'C',
    go: async (page) => {
      await button(page, 'Focus')
      await page.waitForTimeout(500)
      await toTop(page)
    },
  },
  { id: 'c2-last', d: 'C', go: (page) => button(page, 'Focus') },
  { id: 'c3-settings', d: 'C', go: (page) => notes(page) },
  {
    id: 'c4-forgotten',
    d: 'C',
    go: async (page) => {
      await notes(page)
      await button(page, 'Forget…')
      await exact(page, 'Forget it')
      await page.waitForTimeout(400)
      await page.getByRole('radio', { name: 'Conversation' }).click()
      await page.waitForTimeout(400)
      await page.keyboard.press('b')
      await page.keyboard.press('b')
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      await toTop(page)
    },
  },
  {
    id: 'c5-show',
    d: 'C',
    go: async (page) => {
      await button(page, 'Focus')
      await page.waitForTimeout(500)
      await button(page, 'Show all')
    },
  },

  // B in a narrow window: the header keeps the glyphs, the labels in tooltips.
  {
    id: 'n1-b-narrow',
    d: 'B',
    width: 780,
    height: 760,
    room: 'talk',
    go: async (page) => {
      await button(page, 'New chat')
      await page.waitForTimeout(500)
    },
  },
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
  const hash = shot.hash ?? `#/projects/p1?room=${shot.room ?? 'both'}`
  await page.goto(`http://localhost:5363/?d=${shot.d}&bare${hash}`)
  await page.waitForTimeout(1500)
  try {
    await shot.go?.(page)
    // Off the buttons, so no tooltip stands over what was done.
    await page.mouse.move(20, 300)
    await page.waitForTimeout(900)
  } catch (error) {
    errors.push(String(error).split('\n')[0])
  }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`) })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
await browser.close()
