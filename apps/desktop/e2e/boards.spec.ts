import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ElectronApplication, expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { canvasView, inCanvas, shoot } from './canvasViews'
import { launch, openFirstProject, say, shown, startTask, toConversation } from './support'

/*
 * A canvas of boards (ADR-104), in a real window with the fake agents. Asked
 * for boards, a task's lead lays out designs on two pages; the canvas opens
 * beside its conversation on Althar's ground: every board of a page side by
 * side, one board at a time with a step through them, and every page at
 * once, from the bar along its bottom. The person points at a part of a
 * board and says what to change; the comment waits in the composer with the
 * part, its board and its page, and is a pin on the part. The screenshots it
 * takes are this change's evidence (test-results/boards-*.png).
 */

/** A part of the first board of the page shown, its middle in the view's pixels, as the ground has laid it out and scaled it. */
const partOf = (electronApp: ElectronApplication, part: string, board = 0) =>
  inCanvas<{ readonly x: number; readonly y: number }>(
    electronApp,
    `(() => {
      const frame = document.querySelectorAll('iframe')[${board}]
      const inner = frame.contentDocument.querySelector('[data-part="${part}"]').getBoundingClientRect()
      const outer = frame.getBoundingClientRect()
      const scale = outer.width / frame.offsetWidth
      return { x: outer.left + (inner.left + inner.width / 2) * scale, y: outer.top + (inner.top + inner.height / 2) * scale }
    })()`,
  )

/** A press in the canvas's view, as the person's mouse makes one. */
const pressIn = (electronApp: ElectronApplication, at: { readonly x: number; readonly y: number }) =>
  electronApp.evaluate(({ webContents }, point) => {
    const contents = webContents.getAllWebContents().find((one) => one.getURL().startsWith('althar-canvas://'))
    if (contents === undefined) throw new Error('No canvas view.')
    const x = Math.round(point.x)
    const y = Math.round(point.y)
    contents.sendInputEvent({ type: 'mouseMove', x, y })
    contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }, at)

const frames = (electronApp: ElectronApplication) => inCanvas<number>(electronApp, 'document.querySelectorAll("iframe").length')

const open = async (home: string, size = { width: 1440, height: 900 }, scheme?: 'system') => {
  const projects = join(home, 'Projects')
  mkdirSync(projects, { recursive: true })
  const launched = await launch(home, {}, scheme === undefined ? undefined : { scheme })
  const { electronApp, page } = launched
  await electronApp.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0]?.setSize(width, height), size)
  await openFirstProject(electronApp, page, repository(projects))
  await startTask(page, 'Gift a class')
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Open task/ }).click()
  await toConversation(page)
  await say(page, 'Lay out the gift directions. [lead:canvas-boards]')
  await expect(shown(page, /^canvas_publish: Published gift-a-class v1/)).toBeVisible()
  const panel = page.getByRole('complementary', { name: 'Gift a class' })
  await expect(panel).toBeVisible()
  await expect.poll(async () => (await canvasView(electronApp))?.address).toMatch(/\/v1\/\.althar\/boards\.html$/)
  await expect.poll(() => frames(electronApp)).toBe(4)
  // Every board is drawn from the canvas's own page, its stylesheet beside it.
  await expect
    .poll(() =>
      inCanvas<boolean>(
        electronApp,
        '[...document.querySelectorAll("iframe")].every((f) => f.contentDocument?.querySelector("nav") != null && getComputedStyle(f.contentDocument.querySelector("nav")).display === "flex")',
      ),
    )
    .toBe(true)
  return { ...launched, panel }
}

test('a lead lays out boards; the person sees every board, one at a time and every page, and points at a part to say what to change', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page, panel } = await open(home)
  try {
    // Every board of the first page, side by side, fitted; the bar along the bottom.
    await expect(panel.getByText('Boards · The lead of Gift a class')).toBeVisible()
    await expect(panel.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
    await expect(panel.getByRole('button', { name: /^Zoom: \d+%$/ })).toBeVisible()
    // The ground runs in a world of its own: the canvas's page never sees it.
    expect(await inCanvas<string>(electronApp, 'typeof window.__altharGround')).toBe('undefined')
    await shoot(page, electronApp, page, 'test-results/boards-every.png')

    // One board at a time, stepped through.
    await panel.getByRole('radio', { name: 'One board at a time' }).click()
    await expect(panel.getByText('1 of 6')).toBeVisible()
    await expect.poll(() => frames(electronApp)).toBe(1)
    await panel.getByRole('button', { name: 'Next board' }).click()
    await expect(panel.getByText('2 of 6')).toBeVisible()
    await expect(panel.getByText('The card leads', { exact: true })).toBeVisible()
    await expect.poll(() => canvasView(electronApp)).not.toBeNull()
    await expect
      .poll(() => inCanvas<boolean>(electronApp, `document.querySelector('iframe')?.contentDocument?.querySelector('nav') != null`))
      .toBe(true)
    // A board's frame is drawn a moment after its page loads: the picture waits for it.
    await page.waitForTimeout(1_500)
    await shoot(page, electronApp, panel, 'test-results/boards-one.png')

    // Every page at once, a row each.
    await panel.getByRole('radio', { name: 'Every board' }).click()
    await panel.getByRole('button', { name: /^Pages: / }).click()
    await page.getByRole('menuitemradio', { name: /Every page/ }).click()
    await expect.poll(() => frames(electronApp)).toBe(6)
    await expect.poll(() => canvasView(electronApp)).not.toBeNull()
    await shoot(page, electronApp, panel, 'test-results/boards-every-page.png')

    // Back to the directions, the person points at the button on the first board and says what to change.
    await panel.getByRole('button', { name: /^Pages: / }).click()
    await page.getByRole('menuitemradio', { name: /^Directions/ }).click()
    await expect.poll(() => frames(electronApp)).toBe(4)
    // Its boards are counted as they're laid out, before their pages have loaded.
    await expect
      .poll(() =>
        inCanvas<boolean>(electronApp, `document.querySelector('iframe')?.contentDocument?.querySelector('[data-part="go"]') != null`),
      )
      .toBe(true)
    await pressIn(electronApp, await partOf(electronApp, 'go'))
    const field = page.getByRole('textbox', { name: 'Comment on button.go' })
    await expect(field).toBeVisible()
    await field.fill('Say what happens: Send Ana her class.')
    await shoot(page, electronApp, panel, 'test-results/boards-point.png')
    await field.press('Enter')
    await expect(page.getByRole('button', { name: /Say what happens/ })).toBeVisible()
    // Its pin is on the part, drawn as a draft.
    await expect.poll(async () => (await canvasView(electronApp)) !== null).toBe(true)
    await shoot(page, electronApp, page, 'test-results/boards-pinned.png')

    // Save to repo opens on the project's place for artifacts, the canvas's folder named in place; the canvas steps aside for it.
    await panel.getByRole('button', { name: 'Save to repo' }).click()
    const save = page.getByRole('dialog', { name: 'Save to repo' })
    await expect(save.getByRole('textbox', { name: 'Its folder’s name' })).toHaveValue('gift-a-class')
    await expect.poll(() => canvasView(electronApp)).toBeNull()
    await shoot(page, electronApp, page, 'test-results/boards-save.png')
    await page.keyboard.press('Escape')
    await expect(save).toBeHidden()
    // Download offers what a canvas of boards downloads as.
    await panel.getByRole('button', { name: 'Download' }).click()
    await expect(page.getByRole('menuitem', { name: /PNG, a board each/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /PDF, a page a board/ })).toBeVisible()
    await expect.poll(() => canvasView(electronApp)).toBeNull()
    await shoot(page, electronApp, page, 'test-results/boards-download.png')
    await page.keyboard.press('Escape')
    await expect.poll(() => canvasView(electronApp)).not.toBeNull()

    // The project's Artifacts view has it as a card, with a picture of it as it was drawn; opened, it goes beside its conversation.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Artifacts' }).click()
    const cards = page.getByRole('list', { name: 'The project’s artifacts' })
    const card = cards.getByRole('button', { name: /^Gift a class/ })
    await expect(card).toBeVisible()
    await expect(card.locator('img')).toBeVisible()
    await shoot(page, electronApp, page, 'test-results/boards-artifacts.png')
    await card.click()
    await expect(page.getByRole('complementary', { name: 'Gift a class' })).toBeVisible()
    await expect.poll(async () => (await canvasView(electronApp))?.address).toMatch(/\/v1\/\.althar\/boards\.html$/)
    await expect.poll(() => frames(electronApp)).toBe(4)
    await shoot(page, electronApp, page, 'test-results/boards-from-artifacts.png')
    // And back to every artifact.
    await page.getByRole('complementary', { name: 'Gift a class' }).getByRole('button', { name: /^Back/ }).click()
    await expect(cards).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('a canvas of boards in dark, and in a narrow window', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  mkdirSync(join(home, 'profile'), { recursive: true })
  writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance: 'dark' }))
  const { electronApp, page, panel } = await open(home, { width: 1100, height: 760 }, 'system')
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await shoot(page, electronApp, page, 'test-results/boards-dark.png')
    await panel.getByRole('radio', { name: 'One board at a time' }).click()
    await expect(panel.getByText('1 of 6')).toBeVisible()
    await expect.poll(() => canvasView(electronApp)).not.toBeNull()
    await expect.poll(() => frames(electronApp)).toBe(1)
    await page.waitForTimeout(1_500)
    await shoot(page, electronApp, panel, 'test-results/boards-dark-one.png')
  } finally {
    await electronApp.close()
  }
})
