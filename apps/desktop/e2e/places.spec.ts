import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask } from './support'

/*
 * Places are tasks (ADR-037): with one at a time, a task whose lead finished
 * and left a dev server running holds no place, so the next task starts at
 * once. One more waits while that one works, and says which task holds the
 * place.
 */

test('starts the next task beside a finished one’s server, and names the task a waiting one waits for', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    // One at a time.
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    await page.keyboard.press('Meta+,')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: /^Keep awake/ }).click()
    const slider = settings.getByRole('slider', { name: 'Tasks at once' })
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    await page.keyboard.press('Escape')
    await page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()

    await startTask(page, 'Serve the prototype', '[lead:serve] [lead:finish]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    // Its server still runs, and holds no place: the next task starts.
    await startTask(page, 'Add a retry to checkout', '[lead:wait]')
    await expect(page.getByText('Implementing', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/^Waiting: /)).toHaveCount(0)

    // One more waits for the place the second holds, and says so.
    await startTask(page, 'Tidy the logs', '[lead:finish]')
    await expect(page.getByText(/^Waiting: 1 of 1 tasks at work/).first()).toBeVisible()
    await expect(page.getByText('Held by Add a retry to checkout')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/places-waiting.png', fullPage: true })
  } finally {
    await electronApp.close()
  }
})
