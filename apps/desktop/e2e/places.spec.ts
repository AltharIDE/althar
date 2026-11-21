import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, showPanes, startTask, still } from './support'

/* A finished preview stays available without holding a place; a live lead names the place queued work waits for. */

test('frees a finished preview’s place, names the live holder, and starts waiting work when it stops', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    // One at a time, from the quick settings: the gear at the end of the bar, which comes with the first project.
    await page.getByRole('button', { name: /^Althar settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Quick settings' })
    const slider = settings.getByRole('slider', { name: 'Agents at once' })
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()

    await startTask(page, 'Serve the prototype', '[lead:serve] [lead:finish]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await startTask(page, 'Add a retry to checkout', '[lead:wait]')
    await expect(page.getByRole('article', { name: 'Add a retry to checkout', exact: true })).toContainText('Running')
    await expect(page.getByText(/^Waiting · /)).toHaveCount(0)
    await startTask(page, 'Tidy checkout tests', '[lead:finish]')
    await expect(page.getByText(/^Waiting · 1 agent busy$/)).toBeVisible()

    await expect(page.getByRole('button', { name: /^Keeping a place/ })).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/places-waiting.png', scale: 'css', animations: 'disabled' })

    await showPanes(page, { conversation: false, board: true })
    await page.getByRole('region', { name: 'Running' }).getByRole('button', { name: 'Add a retry to checkout', exact: true }).click()
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: /Stop the task/ }).click()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await showPanes(page, { conversation: true, board: false })
    await expect(page.getByText(/^Waiting · /)).toHaveCount(0)
    await expect(page.getByText('Ready', { exact: true })).toHaveCount(2)
    await still(page)
    await page.screenshot({ path: 'test-results/places-started.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
