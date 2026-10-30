import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, say } from './support'

/*
 * A board of every kind of task, in a real window with the fake agent
 * (DEV-96, ADR-035): a change ready to accept, its branch on its card; a
 * task whose lead asks the person, its question its card's why; a change at
 * work, its steps on its card; and a plain task, started with no plan, that
 * finished and waits in Needs you as Finished, opened or not, until the
 * person presses Done or Keep for later (ADR-051). No other card has
 * anything to press but itself. Kept, it waits under Kept, named beside
 * Settled in its head; Done, it settles; written to again, its round ends
 * back in Needs you. Then ⌘K finds a task by what it was about.
 */

test('shows each kind of task on the board, with nothing to press, and finds one by what it was about', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })

    // A change, done and ready to accept, on its branch: no pull request without a host.
    await planTask(page, 'Retry webhook deliveries with backoff', '[lead:finish] [lead:edit]')
    await page.getByRole('button', { name: 'Start now' }).last().click()
    await expect(work.getByText('Ready to accept')).toBeVisible()

    // A plain task, started with no plan: it finishes, and waits as Finished.
    await say(page, 'Which partners still call the v1 endpoint? [coordinator:start] [lead:finish]')
    await expect(work.getByText('Finished', { exact: true })).toBeVisible()

    // A task whose lead asks the person: one card, in Needs you, that says so.
    await planTask(page, 'Move the cache', '[lead:ask]')
    await page.getByRole('button', { name: 'Start now' }).last().click()
    await expect(work.getByText('Question', { exact: true })).toBeVisible()

    // A change at work, its steps on its card.
    await planTask(page, 'Rate-limit refunds per partner', '[lead:slowly] [lead:finish] [lead:edit]')
    await page.getByRole('button', { name: 'Start now' }).last().click()
    const running = work.getByRole('region', { name: 'Running' }).getByRole('article')
    await expect(running).toHaveCount(1)
    await expect(running).toContainText('Rate-limit refunds per partner')
    await page.screenshot({ path: 'test-results/kinds-board.png', animations: 'disabled', scale: 'css' })

    // No card has a button of its own but the finished one's Done and Keep for later: each is its title, which opens its task.
    const finished = work.getByRole('article').filter({ hasText: 'Which partners still call the v1 endpoint' })
    for (const card of await work.getByRole('article').all())
      await expect(card.getByRole('button')).toHaveCount((await card.textContent())?.includes('Which partners') === true ? 3 : 1)
    await finished.screenshot({ path: 'test-results/kinds-finished-card.png', animations: 'disabled', scale: 'css' })

    // Opened, the plain task that finished moves nothing: its header says Finished, with Done and Keep for later beside it.
    await work.getByRole('button', { name: 'Which partners still call the v1 endpoint' }).click()
    await expect(page.getByRole('heading', { name: 'Which partners still call the v1 endpoint', level: 1 })).toBeVisible()
    const header = page.getByRole('banner', { name: 'Which partners still call the v1 endpoint' })
    await expect(header.getByText('Finished', { exact: true })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /^Tell .* something/ })).toHaveAttribute('placeholder', 'Mark this as done')
    await header.screenshot({ path: 'test-results/kinds-finished-header.png', animations: 'disabled', scale: 'css' })
    await page
      .locator('form')
      .filter({ has: page.getByRole('textbox', { name: /^Tell .* something/ }) })
      .screenshot({ path: 'test-results/kinds-finished-composer.png', animations: 'disabled', scale: 'css' })
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(work.getByRole('region', { name: /^Needs you/ }).getByText('Finished', { exact: true })).toBeVisible()

    // Kept for later from its corner, it leaves Needs you for Kept, named beside Settled in its head.
    await finished.getByRole('button', { name: 'Keep for later' }).click()
    const settled = work.getByRole('region', { name: /^Settled/ })
    await settled.getByRole('button', { name: 'Kept 1' }).click()
    await expect(settled.getByText('Which partners still call the v1 endpoint')).toBeVisible()
    await expect(work.getByRole('region', { name: /^Needs you/ }).getByText('Finished', { exact: true })).toHaveCount(0)
    await settled.screenshot({ path: 'test-results/kinds-kept.png', animations: 'disabled', scale: 'css' })

    // Done from there, it settles; written to again, it goes back to work, and its round ends in Needs you, not in Settled.
    await settled.getByRole('button', { name: 'Done' }).click()
    await expect(settled.getByRole('button', { name: /^Kept \d/ })).toHaveCount(0)
    await expect(settled.getByText('Which partners still call the v1 endpoint')).toBeVisible()
    await settled.getByRole('button', { name: 'Which partners still call the v1 endpoint' }).click()
    await say(page, 'And the v2 ones? [lead:finish]')
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(work.getByRole('region', { name: /^Needs you/ }).getByText('Finished', { exact: true })).toBeVisible()
    await expect(settled.getByText('Which partners still call the v1 endpoint')).toHaveCount(0)
    await expect(work.getByText('Ready to accept')).toBeVisible()
    await page.screenshot({ path: 'test-results/kinds-board-again.png', animations: 'disabled', scale: 'css' })

    // ⌘K finds a task by what it was about, and opens it.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    const finder = page.getByRole('dialog')
    await finder.getByRole('combobox').fill('webhook')
    await expect(finder.getByRole('option')).toHaveCount(1)
    await expect(finder.getByRole('option', { name: /Retry webhook deliveries/ })).toContainText('Ready')
    await page.screenshot({ path: 'test-results/kinds-finder.png', animations: 'disabled' })
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Retry webhook deliveries with backoff', level: 1 })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
