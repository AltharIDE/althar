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
const more = (page) => page.getByRole('button', { name: 'More for this project' }).click()
const item = (page, name) => page.getByRole('menuitem', { name }).click()
const press = (page, name) => page.getByRole('button', { name, exact: true }).click()
const say = async (page, words) => {
  const field = page.locator('[contenteditable=true], textarea').first()
  await field.click()
  await field.fill(words)
  await field.press('Enter')
  await page.waitForTimeout(2600)
}
/** The divider, scrolled to the thread's top or into view, as the person would after a clear. */
const toDivider = (page) =>
  page.evaluate(() => {
    const line = [...document.querySelectorAll('div')].find((one) => /divider/.test(one.className) && one.querySelector('[class*=rule]'))
    line?.scrollIntoView({ block: 'center' })
  })
const toTop = (page) =>
  page.evaluate(() => {
    const thread = document.querySelector('section[aria-label="Conversation"]')
    for (let box = thread?.parentElement ?? null; box !== null; box = box.parentElement)
      if (/(auto|scroll)/.test(getComputedStyle(box).overflowY)) {
        box.scrollTop = 0
        break
      }
  })

/** The project's settings, at its notes, as the person opens them: from its views, then down the side. */
const notes = async (page) => {
  await page.getByRole('radio', { name: 'Settings' }).click()
  await page.waitForTimeout(400)
  await page.getByText('Notes', { exact: true }).first().click()
  await page.waitForTimeout(400)
}

const clearA = async (page, forget = false) => {
  await more(page)
  await item(page, 'Clear the conversation…')
  if (forget) await page.getByRole('radio', { name: /Forget it too/ }).click()
  await press(page, forget ? 'Clear and forget' : 'Clear')
}

const shots = [
  // A: one clear, two kinds.
  { id: 'a1-menu', d: 'A', go: (page) => more(page) },
  {
    id: 'a2-confirm',
    d: 'A',
    go: async (page) => {
      await more(page)
      await item(page, 'Clear the conversation…')
    },
  },
  {
    id: 'a3-confirm-forget',
    d: 'A',
    go: async (page) => {
      await more(page)
      await item(page, 'Clear the conversation…')
      await page.getByRole('radio', { name: /Forget it too/ }).click()
    },
  },
  { id: 'a4-cleared', d: 'A', go: (page) => clearA(page) },
  {
    id: 'a5-shown',
    d: 'A',
    go: async (page) => {
      await clearA(page)
      await press(page, 'Show')
      await page.waitForTimeout(300)
      await toDivider(page)
    },
  },
  {
    id: 'a6-answer',
    d: 'A',
    go: async (page) => {
      await clearA(page)
      await say(page, 'Where were we?')
    },
  },
  { id: 'a7-forgotten', d: 'A', go: (page) => clearA(page, true) },
  {
    id: 'a8-forgotten-answer',
    d: 'A',
    go: async (page) => {
      await clearA(page, true)
      await say(page, 'Where were we?')
    },
  },
  { id: 'a9-narrow', d: 'A', width: 900, room: 'talk', go: (page) => clearA(page) },
  // B: a light clear; forgetting in the project's settings.
  { id: 'b1-menu', d: 'B', go: (page) => more(page) },
  {
    id: 'b2-cleared',
    d: 'B',
    go: async (page) => {
      await more(page)
      await item(page, 'Clear the conversation')
    },
  },
  {
    id: 'b3-shown',
    d: 'B',
    go: async (page) => {
      await more(page)
      await item(page, 'Clear the conversation')
      await press(page, 'Show earlier')
      await page.waitForTimeout(300)
      await toDivider(page)
    },
  },
  { id: 'b4-settings', d: 'B', go: (page) => notes(page) },
  {
    id: 'b5-forget-confirm',
    d: 'B',
    go: async (page) => {
      await notes(page)
      await press(page, 'Forget…')
    },
  },
  {
    id: 'b6-forgotten',
    d: 'B',
    go: async (page) => {
      await notes(page)
      await press(page, 'Forget…')
      await press(page, 'Forget conversation')
      await page.waitForTimeout(400)
      await page.getByRole('radio', { name: 'Conversation' }).click()
      await page.waitForTimeout(600)
      await toTop(page)
    },
  },
  // C: a new conversation, carrying a summary; earlier ones kept to read, or deleted.
  { id: 'c1-menu', d: 'C', go: (page) => more(page) },
  {
    id: 'c2-new',
    d: 'C',
    go: async (page) => {
      await more(page)
      await item(page, 'New conversation')
      await page.waitForTimeout(300)
      await toTop(page)
    },
  },
  {
    id: 'c3-answer',
    d: 'C',
    go: async (page) => {
      await more(page)
      await item(page, 'New conversation')
      await say(page, 'Where were we?')
    },
  },
  {
    id: 'c4-menu-earlier',
    d: 'C',
    go: async (page) => {
      await more(page)
      await item(page, 'New conversation')
      await say(page, 'Where were we?')
      await more(page)
    },
  },
  {
    id: 'c5-past',
    d: 'C',
    go: async (page) => {
      await more(page)
      await item(page, 'New conversation')
      await press(page, 'Read the last one')
      await page.waitForTimeout(300)
      await toTop(page)
    },
  },
  {
    id: 'c6-delete',
    d: 'C',
    go: async (page) => {
      await more(page)
      await item(page, 'New conversation')
      await press(page, 'Read the last one')
      await press(page, 'Delete…')
    },
  },
  {
    id: 'c7-deleted',
    d: 'C',
    go: async (page) => {
      await more(page)
      await item(page, 'New conversation')
      await press(page, 'Read the last one')
      await press(page, 'Delete…')
      await press(page, 'Delete conversation')
      await page.waitForTimeout(300)
      await toTop(page)
    },
  },
]

const browser = await chromium.launch()
for (const shot of shots.filter((one) => only.length === 0 || only.includes(one.id))) {
  const page = await browser.newPage({ viewport: { width: shot.width ?? 1280, height: 800 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const hash = shot.hash ?? `#/projects/p1?room=${shot.room ?? 'both'}`
  await page.goto(`http://localhost:5363/?d=${shot.d}&bare${hash}`)
  await page.waitForTimeout(1500)
  try {
    await shot.go(page)
    // Off the buttons, so no tooltip stands over what was done.
    await page.mouse.move(640, 790)
    await page.waitForTimeout(700)
  } catch (error) {
    errors.push(String(error).split('\n')[0])
  }
  await page.screenshot({ path: resolve(out, `${shot.id}.png`) })
  process.stdout.write(`${shot.id}  ${errors.length === 0 ? 'ok' : errors.join(' | ')}\n`)
  await page.close()
}
await browser.close()
