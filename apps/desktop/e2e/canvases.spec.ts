import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, shown, startTask, still, toConversation } from './support'

/*
 * The project's canvases (ADR-104), in a real window with the fake agents.
 * Asked to draw, a task's lead writes three canvases in its folder and
 * publishes them: directions with a diagram, a chart, and a page, which
 * opens beside its conversation in a view of its own, served at its
 * version's address. Each is a line in the thread that opens it. The person
 * comments on words in the directions; the comment waits in the composer,
 * goes with their message, and the lead reads it, draws v2 in answer and
 * resolves it. Another task's lead lists the same canvases, and the
 * project's Artifacts view has them all. The screenshots it takes are this
 * change's own evidence (test-results/canvas-*.png).
 */

/** The canvas view laid over the window: its bounds, the address it shows, and a picture of it as the person sees it, at 1×. */
const canvasView = (electronApp: ElectronApplication) =>
  electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((one) => one.webContents.getURL().includes('/renderer/index.html'))
    const view = window?.contentView.children.find(
      (child): child is Electron.WebContentsView =>
        'webContents' in child &&
        (child as Electron.WebContentsView).webContents.getURL().startsWith('althar-canvas://') &&
        child.getVisible(),
    )
    if (view === undefined) return null
    const bounds = view.getBounds()
    const picture = await view.webContents.capturePage()
    const sized = picture.getSize().width > bounds.width ? picture.resize({ width: bounds.width }) : picture
    return {
      bounds,
      address: view.webContents.getURL(),
      png: sized.toPNG().toString('base64'),
      partition: view.webContents.session.storagePath ?? '',
    }
  })

/** Runs a script in the canvas's own page, as its scripts run. */
const inCanvas = <T>(electronApp: ElectronApplication, code: string) =>
  electronApp.evaluate(async ({ webContents }, script) => {
    const contents = webContents.getAllWebContents().find((one) => one.getURL().startsWith('althar-canvas://'))
    if (contents === undefined) throw new Error('No canvas view.')
    return (await contents.executeJavaScript(script, true)) as unknown
  }, code) as Promise<T>

/**
 * A picture of a part of the window as the person sees it: the canvas is a view of its own over the window, which the
 * window's own screenshot leaves out, so its picture is laid where it is first.
 */
const shoot = async (page: Page, electronApp: ElectronApplication, of: Locator | Page, path: string) => {
  const view = await canvasView(electronApp)
  if (view !== null)
    await page.evaluate((drawn) => {
      const picture = document.createElement('img')
      picture.src = `data:image/png;base64,${drawn.png}`
      picture.dataset.drawn = ''
      Object.assign(picture.style, {
        position: 'fixed',
        left: `${drawn.bounds.x}px`,
        top: `${drawn.bounds.y}px`,
        width: `${drawn.bounds.width}px`,
        height: `${drawn.bounds.height}px`,
        pointerEvents: 'none',
        zIndex: '2147483647',
      })
      document.getElementById('root')?.append(picture)
    }, view)
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[data-drawn]')].every((one) => one.complete))
  await still(page)
  await of.screenshot({ path, animations: 'disabled', scale: 'css' })
  await page.evaluate(() => {
    for (const one of document.querySelectorAll('img[data-drawn]')) one.remove()
  })
}

test('a lead draws the project’s canvases, the person comments, the lead draws again, and every lead and the project see them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    // Nothing goes to the person's real browser: what would is kept to look at.
    await electronApp.evaluate(({ shell }) => {
      const opened: Array<string> = []
      ;(globalThis as unknown as { opened: Array<string> }).opened = opened
      shell.openExternal = async (url: string) => void opened.push(url)
    })
    await openFirstProject(electronApp, page, repository(projects))
    await startTask(page, 'Redesign sign-in')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)

    // Asked to draw, the lead publishes three canvases; the page opens beside the conversation as it arrives.
    await say(page, 'Draw the sign-in directions. [lead:canvas]')
    await expect(shown(page, /^canvas_publish: Published sign-in-page v1/)).toBeVisible()
    const directions = page.getByRole('button', { name: 'Open Sign-in, three directions beside the conversation' })
    await expect(directions).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Checkout funnel beside the conversation' })).toBeVisible()
    const panel = page.getByRole('complementary', { name: 'Sign-in page' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Page · The lead of Redesign sign-in')).toBeVisible()

    // It is a view of its own at its version's address, in the project's canvas partition, its style from a file beside it.
    await expect.poll(async () => (await canvasView(electronApp))?.address).toMatch(/^althar-canvas:\/\/[0-9a-f]{32}\/v1\/$/)
    expect((await canvasView(electronApp))?.partition).toMatch(/canvases-[0-9a-f]{32}/)
    await expect.poll(() => inCanvas<string>(electronApp, 'getComputedStyle(document.body).backgroundColor')).toBe('rgb(244, 242, 236)')
    // It runs its own script, and reaches nothing of Althar's: no bridge, no Node.
    await inCanvas(electronApp, 'document.getElementById("send").click()')
    expect(await inCanvas<string>(electronApp, 'document.getElementById("send").textContent')).toBe('Code sent')
    expect(await inCanvas<string>(electronApp, 'typeof window.althar + " " + typeof window.require + " " + typeof process')).toBe(
      'undefined undefined undefined',
    )
    // A link out of it goes to the person's browser, never in its view.
    await inCanvas(electronApp, 'location.href = "https://example.com/terms"')
    await expect
      .poll(() => electronApp.evaluate(() => (globalThis as unknown as { opened: Array<string> }).opened))
      .toContain('https://example.com/terms')
    expect((await canvasView(electronApp))?.address).toMatch(/\/v1\/$/)
    await shoot(page, electronApp, page, 'test-results/canvas-page-beside.png')
    await shoot(page, electronApp, panel, 'test-results/canvas-page-panel.png')

    // The chart, from its line: a picture, its script never run.
    await page.getByRole('button', { name: 'Open Checkout funnel beside the conversation' }).click()
    const funnel = page.getByRole('complementary', { name: 'Checkout funnel' })
    await expect(funnel.getByRole('img', { name: 'Checkout funnel' })).toBeVisible()
    await expect.poll(() => canvasView(electronApp)).toBeNull()
    await shoot(page, electronApp, funnel, 'test-results/canvas-chart.png')

    // The directions: a document with its diagram drawn.
    await directions.click()
    const doc = page.getByRole('complementary', { name: 'Sign-in, three directions' })
    await expect(doc.getByRole('img', { name: 'Diagram' })).toBeVisible()
    await expect(doc.getByText('First directions')).toBeVisible()

    // The person selects words in it and comments on them; the comment waits in the composer, the person's own until sent.
    await doc.getByText('B, split:').evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await doc.getByRole('button', { name: 'Comment' }).click()
    const field = doc.getByPlaceholder('Comment on “B, split:”')
    await field.fill('Put the picture on the left, so the field is read first.')
    await shoot(page, electronApp, doc, 'test-results/canvas-comment.png')
    await field.press('Enter')
    await expect(page.getByRole('button', { name: /Put the picture on the left/ })).toBeVisible()
    await shoot(page, electronApp, page, 'test-results/canvas-comment-composer.png')

    // Sent with the person's words, the lead reads it, draws v2 in answer and resolves it.
    await say(page, 'One change, then draw it again. [lead:canvas-again]')
    await expect(shown(page, /^canvas_publish: Published sign-in v2 on v1/)).toBeVisible()
    await expect(shown(page, /Marked 1 comment on sign-in as answered by v2/)).toBeVisible()
    const said =
      (await shown(page, /^canvas_get: /)
        .last()
        .locator('xpath=..')
        .textContent()) ?? ''
    expect(said).toContain('on “B, split:” under Sign in: Put the picture on the left, so the field is read first.')
    // Its line for v2: the reply streams in before the window has read the line, so it is waited for, not taken as the last.
    await directions.filter({ hasText: 'v2' }).click()
    const again = page.getByRole('complementary', { name: 'Sign-in, three directions' })
    await expect(again.getByText('The picture on the left, as asked')).toBeVisible()
    await expect(again.getByText('v2', { exact: true })).toBeVisible()
    await expect(again.getByText(/on v1 · Answered/)).toBeVisible()
    await expect(again.getByText('Moved the picture to the left in v2.')).toBeVisible()
    await shoot(page, electronApp, again, 'test-results/canvas-v2.png')

    // A step back shows v1 as it was, and says v2 is out.
    await again.getByRole('button', { name: 'Older version' }).click()
    await expect(again.getByText('v2 is out')).toBeVisible()
    await expect(again.getByText('First directions')).toBeVisible()
    await shoot(page, electronApp, again, 'test-results/canvas-older.png')
    await page.screenshot({ path: 'test-results/canvas-thread.png', scale: 'css' })

    // Another task's lead reaches the same canvases: they are the project's.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Build sign-in')
    const second = page.getByRole('article', { name: 'Build sign-in' })
    await expect(second.getByText('Ready', { exact: true })).toBeVisible()
    await second.getByRole('button', { name: /^(Open task|Answer)/ }).click()
    await toConversation(page)
    await say(page, 'What is drawn already? [lead:canvas-list]')
    await expect(shown(page, /^sign-in: Sign-in, three directions \(markdown\), v2 by the lead of Redesign sign-in/)).toBeVisible()
    await expect(shown(page, /^sign-in-page: Sign-in page \(html\), v1/)).toBeVisible()
    await shoot(page, electronApp, page, 'test-results/canvas-other-lead.png')

    // And the project's Artifacts view has them all, in one table, the newest first; one opened takes the view.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Artifacts' }).click()
    const table = page.getByRole('table', { name: 'The project’s artifacts' })
    await expect(table.getByRole('row')).toHaveCount(4)
    const directionsRow = table.getByRole('row').filter({ hasText: 'Sign-in, three directions' })
    await expect(directionsRow).toContainText('Document')
    await expect(directionsRow).toContainText('Lead of Redesign sign-in')
    await shoot(page, electronApp, page, 'test-results/canvas-artifacts.png')
    await table.getByRole('button', { name: 'Sign-in page' }).click()
    await expect(page.getByRole('complementary', { name: 'Sign-in page' })).toBeVisible()
    await expect.poll(async () => (await canvasView(electronApp))?.address).toMatch(/\/v1\/$/)
    await shoot(page, electronApp, page, 'test-results/canvas-artifacts-open.png')
  } finally {
    await electronApp.close()
  }
})
