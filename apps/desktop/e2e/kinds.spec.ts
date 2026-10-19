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
 * finished and waits as Finished until the person opens it, when it is Done.
 * No card has anything to press but itself. Then ⌘K finds a task by what it
 * was about.
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
    await expect(work.getByText('Ready to accept')).toBeVisible({ timeout: 30_000 })

    // A plain task, started with no plan: it finishes, and waits as Finished.
    await say(page, 'Which partners still call the v1 endpoint? [coordinator:start] [lead:finish]')
    await expect(work.getByText('Finished', { exact: true })).toBeVisible({ timeout: 30_000 })

    // A task whose lead asks the person: one card, in Needs you, that says so.
    await planTask(page, 'Move the cache', '[lead:ask]')
    await page.getByRole('button', { name: 'Start now' }).last().click()
    await expect(work.getByText('Question', { exact: true })).toBeVisible({ timeout: 30_000 })

    // A change at work, its steps on its card.
    await planTask(page, 'Rate-limit refunds per partner', '[lead:slowly] [lead:finish] [lead:edit]')
    await page.getByRole('button', { name: 'Start now' }).last().click()
    const running = work.getByRole('region', { name: 'Running' }).getByRole('article')
    await expect(running).toHaveCount(1, { timeout: 30_000 })
    await expect(running).toContainText('Rate-limit refunds per partner')
    await page.screenshot({ path: 'test-results/kinds-board.png', animations: 'disabled' })

    // No card has a button of its own: each is its title, which opens its task.
    for (const card of await work.getByRole('article').all()) await expect(card.getByRole('button')).toHaveCount(1)

    // Opened, the plain task that finished is done: it settles.
    await work.getByRole('button', { name: 'Which partners still call the v1 endpoint' }).click()
    await expect(page.getByRole('heading', { name: 'Which partners still call the v1 endpoint', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(work.getByText('Finished', { exact: true })).toHaveCount(0)
    await expect(work.getByText('Ready to accept')).toBeVisible()
    await page.screenshot({ path: 'test-results/kinds-board-seen.png', animations: 'disabled' })

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
