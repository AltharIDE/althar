import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { canvasView, inCanvas, pressIn, shoot } from './canvasViews'
import { launch, openFirstProject, say, shown, startTask, toConversation } from './support'

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
    // Its name and close float on the page, drawn in its own view: never in the task's header, and no head of its own.
    await expect(page.getByRole('button', { name: 'Close the panel' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open Sign-in page', exact: true })).toHaveCount(0)
    await expect.poll(() => canvasView(electronApp)).not.toBeNull()
    await expect
      .poll(() => inCanvas<boolean>(electronApp, `document.querySelector('althar-chip')?.hidden === false`).catch(() => false))
      .toBe(true)

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

    // The page rewrites its document and lays its own over all of it: an overlay, then a popover in the top layer, then a
    // modal dialog, which makes all outside it inert. Its chip is still there, over it all and inside the modal, and its
    // close still closes the canvas.
    await inCanvas(
      electronApp,
      `(() => {
        document.documentElement.innerHTML = '<body><div style="position:fixed;inset:0;z-index:2147483647;background:#0003"></div>' +
          '<div id="tip" popover="manual" style="inset:0;width:100vw;height:100vh;margin:0;border:0;background:#0002">A popover of its own</div>' +
          '<dialog id="modal" style="width:100vw;height:100vh;max-width:none;max-height:none;margin:0;border:0">A modal of its own</dialog>' +
          '<p>Rewritten</p></body>'
        document.getElementById('tip').showPopover()
        document.getElementById('modal').showModal()
      })()`,
    )
    await expect
      .poll(() =>
        inCanvas<boolean>(electronApp, `document.querySelector('#modal > althar-chip')?.matches(':popover-open') === true`).catch(
          () => false,
        ),
      )
      .toBe(true)
    await shoot(page, electronApp, panel, 'test-results/canvas-page-modal.png')
    // The modal closed, the chip comes back out over the page's popover; opened again, back in it.
    const chipIn = (where: string) =>
      expect
        .poll(() => inCanvas<boolean>(electronApp, `document.querySelector('${where} > althar-chip') !== null`).catch(() => false))
        .toBe(true)
    await inCanvas(electronApp, `document.getElementById('modal').close()`)
    await chipIn('html')
    await inCanvas(electronApp, `document.getElementById('modal').showModal()`)
    await chipIn('#modal')
    const chipBox = await inCanvas<{ readonly right: number; readonly top: number; readonly height: number }>(
      electronApp,
      `(() => { const r = document.querySelector('althar-chip').getBoundingClientRect(); return { right: r.right, top: r.top, height: r.height } })()`,
    )
    await pressIn(electronApp, { x: chipBox.right - 18, y: chipBox.top + chipBox.height / 2 })
    await expect(panel).toBeHidden()

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

    // The person selects words in it and comments on them; the comment waits in the composer, the person's own until sent.
    await doc.getByText('B, split:').evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    // Its actions are in the task's own row, after its header: the canvas has no head of its own.
    await doc.getByRole('button', { name: 'Comment', exact: true }).click()
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
    await expect(again.getByText(/on v1 · Answered/)).toBeVisible()
    await expect(again.getByText('Moved the picture to the left in v2.')).toBeVisible()
    await shoot(page, electronApp, again, 'test-results/canvas-v2.png')
    // Beside the task, it is what it is, floating on it: its name, which opens the artifact itself (its versions, saving and
    // downloading are there), Comment and close; never in the task's header.
    await expect(again.getByRole('button', { name: 'Open Sign-in, three directions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Older version' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save to repo' })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/canvas-thread.png', scale: 'css' })

    // Opened as itself, a step back shows v1 as it was, and says v2 is out; then back to the task.
    await again.getByRole('button', { name: 'Open Sign-in, three directions' }).click()
    await expect(page.getByRole('button', { name: 'Back to Artifacts' })).toBeVisible()
    await expect(page.getByText('v2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Older version' }).click()
    const older = page.getByRole('complementary', { name: 'Sign-in, three directions' })
    await expect(older.getByText('v2 is out')).toBeVisible()
    await expect(page.getByText('v1 of 2')).toBeVisible()
    await shoot(page, electronApp, page, 'test-results/canvas-older.png')
    await page.getByRole('button', { name: 'Back to Artifacts' }).click()
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Home' }).click()
    await page
      .getByRole('article', { name: 'Redesign sign-in' })
      .getByRole('button', { name: /^(Open task|Answer)/ })
      .click()
    await toConversation(page)

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
    // As cards first; as a list, one table.
    await expect(page.getByRole('list', { name: 'The project’s artifacts' }).getByRole('button', { name: /^Sign-in page/ })).toBeVisible()
    await page.getByRole('radiogroup', { name: 'Show as' }).getByRole('radio', { name: 'List' }).click()
    const table = page.getByRole('table', { name: 'The project’s artifacts' })
    await expect(table.getByRole('row')).toHaveCount(4)
    const directionsRow = table.getByRole('row').filter({ hasText: 'Sign-in, three directions' })
    await expect(directionsRow).toContainText('Document')
    await expect(directionsRow).toContainText('Lead of Redesign sign-in')
    await shoot(page, electronApp, page, 'test-results/canvas-artifacts.png')
    // Opened, it is the artifact itself, with its own chat beside it: the chat's top row is the artifact's, never a task's.
    await table.getByRole('button', { name: 'Sign-in page' }).click()
    await expect(page.getByRole('complementary', { name: 'Sign-in page' })).toBeVisible()
    // Its one top row is the artifact's, in the project's place: no project header, no task's, and no head on the canvas.
    const chat = page.getByRole('region', { name: 'Its chat' })
    await expect(page.getByRole('button', { name: /^Sign-in page/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to Artifacts' })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'View' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Back to meridian' })).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Sign-in page' }).getByRole('button', { name: 'Close the panel' })).toHaveCount(0)
    await expect(chat.getByPlaceholder('Ask about it, or say what to change')).toBeVisible()
    await expect.poll(async () => (await canvasView(electronApp))?.address).toMatch(/\/v1\/$/)
    await shoot(page, electronApp, page, 'test-results/canvas-artifacts-open.png')

    // The person talks to it: going to its composer starts its own chat, and what they say goes there, beside it.
    const words = chat.getByPlaceholder('Ask about it, or say what to change')
    await words.click()
    await words.fill('Make the button calmer.')
    await words.press('Enter')
    await expect(chat.getByText('Make the button calmer.')).toBeVisible()
    await expect(chat.getByPlaceholder('Ask about it, or say what to change')).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Sign-in page' })).toBeVisible()
    await page.waitForTimeout(1_500)
    await shoot(page, electronApp, page, 'test-results/canvas-artifact-chat.png')

    // Escape goes back to every artifact.
    await page.locator('body').press('Escape')
    await expect(table).toBeVisible()

    // Its chat is never a task: not on the board, nor among the asides.
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Home' }).click()
    await expect(page.getByText('Redesign sign-in').first()).toBeVisible()
    // (Its name is still in the coordinator's conversation, on the line of the canvas the lead drew.)
    await expect(page.getByRole('article', { name: /Sign-in page/ })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: /Sign-in page/ })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

test('a coordinator aside opens canvases and files over the board', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 800))
    await openFirstProject(electronApp, page, repository(home))
    await page.getByRole('button', { name: 'New aside' }).click()
    const composer = page.getByRole('textbox', { name: /^Ask on the side/ })
    await composer.fill('Compare sign-in directions')
    await composer.press('Enter')
    await expect(page.getByRole('button', { name: 'Make it a task' })).toBeVisible()
    const reply = page.getByRole('textbox', { name: 'Reply', exact: true })
    await reply.fill('Draw the sign-in directions. [lead:canvas]')
    await reply.press('Enter')
    await expect(page.getByRole('complementary', { name: 'Sign-in page' })).toBeVisible()
    await expect.poll(() => canvasView(electronApp)).not.toBeNull()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
    await expect.poll(() => canvasView(electronApp)).toBeNull()
    await page.keyboard.press('Escape')
    await expect.poll(() => canvasView(electronApp)).not.toBeNull()
    await page.getByRole('button', { name: 'Open Checkout funnel beside the conversation' }).click()
    await expect(page.getByRole('img', { name: 'Checkout funnel' })).toBeVisible()
    await reply.fill('Open the sign-in document. [lead:canvas-open]')
    await reply.press('Enter')
    const doc = page.getByRole('complementary', { name: 'Sign-in, three directions' })
    await expect(doc.getByRole('button', { name: 'Open Sign-in, three directions', exact: true })).toBeVisible()
    const answer = page.getByRole('paragraph').filter({ hasText: 'The repository also has' })
    // The streamed answer gives way to the kept one: scrolled to once it stays.
    await expect(async () => await answer.scrollIntoViewIfNeeded({ timeout: 1_000 })).toPass()
    await expect(doc).toBeInViewport()
    await shoot(page, electronApp, page, 'test-results/aside-canvas-beside.png')
    await answer.getByRole('button', { name: 'Open README.md' }).click()
    const file = page.getByRole('complementary', { name: 'README.md' })
    await expect(file.getByRole('heading', { name: 'meridian' })).toBeVisible()
    await shoot(page, electronApp, page, 'test-results/aside-file-beside.png')
  } finally {
    await electronApp.close()
  }
})
