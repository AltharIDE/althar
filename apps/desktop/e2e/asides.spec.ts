import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { holdRuntime, launch, openFirstProject, say, shown, still } from './support'

/*
 * Asides (docs/decisions/tasks.md, "Asides"), in a real window with the fake
 * agent: pills over the coordinator's conversation, the coordinator first and
 * its turns signed so. One is started from the coordinator's composer, opens
 * in its place with a composer and moves of its own, and leaves for the board
 * made a task, by the person's word or once its agent changes the
 * repository, the coordinator's conversation keeping a line of each; words
 * the coordinator said, selected, start one about them. The screenshots are
 * this change's evidence (test-results/asides-*.png).
 */

/**
 * Holds what the window sends the runtime, as holdRuntime does, and sends the
 * clear of `taskId` for a task the runtime doesn't have, so the runtime answers
 * it without settling anything.
 */
const keepOnScratch = async (page: Page, taskId: string) => {
  await page.evaluate((taskId) => {
    const held: Array<() => void> = []
    // oxlint-disable-next-line typescript/unbound-method -- applied to the port it was called on
    const post = MessagePort.prototype.postMessage
    const misname = (message: unknown): unknown =>
      JSON.stringify(message)?.includes('MarkTaskDone') === true
        ? JSON.parse(JSON.stringify(message).replaceAll(taskId, 'tsk_none'))
        : message
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: Parameters<MessagePort['postMessage']>) {
      if (args[0] === null || args[0] === undefined) post.apply(this, args)
      else held.push(() => post.call(this, misname(args[0]), ...(args.slice(1) as [])))
    } as MessagePort['postMessage']
    Object.assign(window, {
      release: () => {
        MessagePort.prototype.postMessage = post
        for (const send of held.splice(0)) send()
      },
    })
  }, taskId)
  return () => page.evaluate(() => (window as unknown as { release: () => void }).release())
}

/** The conversation's column, from its pills down, at 1×. */
const shoot = async (page: Page, pills: Locator, name: string) => {
  const box = await pills.boundingBox()
  const height = page.viewportSize()?.height ?? 800
  if (box === null) return
  await still(page)
  await page.screenshot({
    path: `test-results/asides-${name}.png`,
    clip: { x: 0, y: box.y - 8, width: box.x + box.width + 12, height: height - box.y + 8 },
    scale: 'css',
  })
}

/** Starts an aside from the coordinator's composer, as the person does with +. */
const startAside = async (page: Page, words: string) => {
  await page.getByRole('button', { name: 'New aside' }).click()
  const box = page.getByRole('textbox', { name: /^Ask on the side/ })
  await box.click()
  await box.fill(words)
  await box.press('Enter')
}

test('asides: started beside the coordinator, opened in its place with a composer of their own, made a task and noted', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const pills = page.getByRole('tablist', { name: 'Conversations' }).filter({ visible: true })
    const coordinator = pills.getByRole('tab', { name: 'Coordinator' })
    await expect(coordinator).toHaveAttribute('aria-selected', 'true')

    // The coordinator answers, its turn signed Coordinator rather than with its model.
    await say(page, 'What does the checkout retry do?')
    const answer = page.getByRole('article', { name: 'Coordinator' }).filter({ visible: true }).last()
    await expect(answer).toBeVisible()
    await expect(answer.getByRole('button', { name: 'Copy' })).toBeAttached()

    // A new aside, from +: the coordinator's composer starts it, and it opens in the coordinator's place.
    await startAside(page, 'Which file holds the retry?\n[lead:finish] [lead:answered]')
    const aside = pills.getByRole('tab', { name: 'Which file holds the retry?' })
    await expect(aside).toHaveAttribute('aria-selected', 'true')
    await expect(shown(page, 'Which file holds the retry?').first()).toBeVisible()
    // Its moves over its composer, which is a task's own.
    const makeTask = page.getByRole('button', { name: 'Make it a task' })
    await expect(makeTask).toBeVisible()
    await expect(page.getByRole('article', { name: 'Coordinator' }).filter({ visible: true }).first()).toBeVisible()
    await shoot(page, pills, 'open')

    // Made a task: it leaves the pills for the board, and the coordinator's conversation keeps a line of it.
    await makeTask.click()
    await expect(aside).toHaveCount(0)
    await expect(coordinator).toHaveAttribute('aria-selected', 'true')
    const line = shown(page, 'An aside became a task: Which file holds the retry?')
    await expect(line).toBeVisible()
    await expect(page.getByRole('region', { name: 'The project’s work' }).getByText('Which file holds the retry?')).toBeVisible()
    await line.scrollIntoViewIfNeeded()
    await shoot(page, pills, 'made-a-task')

    // One whose agent changes the repository goes to the board by itself.
    await startAside(page, 'Shorten the retry wait\n[lead:finish] [lead:edit]')
    await expect(shown(page, 'An aside became a task: Shorten the retry wait')).toBeVisible()
    await expect(pills.getByRole('tab', { name: 'Shorten the retry wait' })).toHaveCount(0)

    // Cleared from the × on its pill: it goes, the coordinator's conversation back in its place, while the runtime is held,
    // and stays gone once the runtime has settled it (docs/decisions/foundations.md, "The UI is instant").
    await startAside(page, 'Is the retry capped?\n[lead:finish] [lead:answered]')
    const capped = pills.getByRole('tab', { name: 'Is the retry capped?' })
    await expect(capped).toHaveAttribute('aria-selected', 'true')
    await expect(shown(page, /Althar has your summary/).first()).toBeVisible()
    await expect(page.locator('[data-aside] [class*="dot"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0)
    await shoot(page, pills, 'clear')
    const release = await holdRuntime(page)
    await pills.getByRole('button', { name: 'Clear “Is the retry capped?”' }).click()
    await expect(capped).toHaveCount(0)
    await expect(coordinator).toHaveAttribute('aria-selected', 'true')
    await release()
    // Settled, it is the board's: in its Settled lane, never back in the pills.
    await expect(page.getByRole('region', { name: 'The project’s work' }).getByText('Is the retry capped?')).toBeAttached()
    await expect(capped).toHaveCount(0)
    await expect(shown(page, /wasn’t cleared/)).toHaveCount(0)
    await shoot(page, pills, 'cleared')

    // One the runtime answers without settling goes at once all the same, and comes back once the runtime has answered,
    // with a line under the pills that says so. The clear is sent for a task the runtime doesn't have, which it answers
    // as it does one with something open: it settles nothing, and the aside is still on Scratch.
    await startAside(page, 'Which cache?\n[lead:finish] [lead:answered]')
    const which = pills.getByRole('tab', { name: 'Which cache?' })
    await expect(which).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-aside] [class*="dot"]')).toHaveCount(0)
    const id = await pills
      .locator('[data-aside]')
      .filter({ has: page.getByRole('tab', { name: 'Which cache?' }) })
      .getAttribute('data-aside')
    const answered = await keepOnScratch(page, id ?? '')
    await pills.getByRole('button', { name: 'Clear “Which cache?”' }).click()
    await expect(which).toHaveCount(0)
    await answered()
    await expect(which).toBeVisible()
    const notCleared = page.getByRole('alert').filter({ hasText: '“Which cache?” wasn’t cleared' })
    await expect(notCleared).toBeVisible()
    await expect(which).toBeInViewport()
    await expect(notCleared).toBeInViewport()
    await shoot(page, pills, 'not-cleared')

    // Words the coordinator said, selected, start an aside about them, quoted over the composer.
    await answer.locator('p').first().click({ clickCount: 3 })
    await page.getByRole('button', { name: 'Ask in an aside' }).click()
    await expect(page.getByRole('button', { name: 'Drop the quote' })).toBeVisible()
    await expect(pills.getByRole('tab', { name: 'New aside' })).toHaveAttribute('aria-selected', 'true')
    await shoot(page, pills, 'quote')
  } finally {
    await electronApp.close()
  }
})
