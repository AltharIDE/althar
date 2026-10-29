import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, startTask } from './support'

/*
 * Tasks started while every place is taken wait in the board's Up next, in the
 * order they will start, above the plans, not in Running: nothing of them has
 * had an agent. With one agent at a time, held by a server a finished task
 * left running, three tasks wait, one plan is held and one counts down. When
 * the server is stopped, the first that waited moves to Running by itself.
 * Shots: test-results/upnext-*.png.
 */

test('lists the tasks that wait for a free agent in Up next, in the order they start, above the plans', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    // One agent at a time.
    const tabs = page.getByRole('navigation', { name: 'Projects' })
    await page.getByRole('button', { name: /^Althar settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Quick settings' })
    const slider = settings.getByRole('slider', { name: 'Agents at once' })
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await tabs.getByRole('button', { name: /^meridian/ }).click()

    await startTask(page, 'Serve the prototype', '[lead:serve] [lead:finish]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await startTask(page, 'Add a retry', '[lead:wait]')
    await startTask(page, 'Tidy the docs', '[lead:finish]')
    await startTask(page, 'Rename the helper', '[lead:finish]')
    await expect(page.getByText(/^Waiting: 1 of 1 agents busy/)).toHaveCount(3)
    // A plan the person holds, and one counting down, are not started either.
    await planTask(page, 'Hold this plan')
    // Exactly: the plan up next on the board beside is named for it.
    await page.getByRole('button', { name: 'Hold', exact: true }).last().click()
    await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Held. Starts when you say')).toBeVisible()
    await planTask(page, 'Plan the release')

    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const next = work.getByRole('region', { name: 'Up next' })
    const running = work.getByRole('region', { name: 'Running' })
    await expect(next.getByText('Starts when an agent is free')).toBeVisible()
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'test-results/upnext-board.png', animations: 'disabled' })

    await tabs.getByRole('button', { name: /^Home/ }).click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'test-results/upnext-home.png', animations: 'disabled' })
    await tabs.getByRole('button', { name: /^meridian/ }).click()

    // Up next lists the three in the order they started, then the plan on its countdown, then the held one; none is in Running.
    const rows = next.getByRole('listitem')
    await expect(rows).toHaveCount(5)
    await expect(rows.nth(0)).toContainText('Add a retry')
    await expect(rows.nth(1)).toContainText('Tidy the docs')
    await expect(rows.nth(2)).toContainText('Rename the helper')
    await expect(rows.nth(3)).toContainText('Plan the release')
    await expect(rows.nth(4)).toContainText('Hold this plan')
    await expect(running.getByRole('article')).toHaveCount(0)

    // The place frees: the first that waited starts by itself, and moves to Running.
    await page.getByRole('radio', { name: /^Conversation/ }).click()
    await page
      .getByRole('button', { name: /^Keeping a place/ })
      .first()
      .click()
    await page.getByRole('dialog', { name: 'Keeping a place' }).getByRole('button', { name: /^Stop/ }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    await expect(running.getByRole('button', { name: 'Add a retry' })).toBeVisible()
    await expect(rows.nth(0)).toContainText('Tidy the docs')
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'test-results/upnext-started.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
