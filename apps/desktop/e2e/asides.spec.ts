import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, shown, still } from './support'

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
