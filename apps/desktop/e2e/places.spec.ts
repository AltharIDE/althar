import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask } from './support'

/*
 * Who holds the places a waiting task waits for (ADR-032): with one agent at a
 * time, a task whose lead finished but left a dev server running keeps its
 * place (the fake agent is no process of its own here, so its CPU can't be
 * read and it counts), the next task's plan waits, and its card names the one
 * that holds it and the server, which it can stop from there: the waiting task
 * then starts on its own.
 */

test('names the task whose server keeps a place, and stops it from the plan that waits', async () => {
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
    await startTask(page, 'Add a retry to checkout', '[lead:finish]')
    await expect(page.getByText(/^Waiting: 1 of 1 agents busy/).first()).toBeVisible()

    // Its plan card, not started, says who holds the place: the server that keeps it, with the task it is from.
    const pill = page.getByRole('button', { name: /^Keeping a place/ })
    await expect(pill).toBeVisible()
    await pill.click()
    await expect(page.getByRole('dialog', { name: 'Keeping a place' })).toContainText('Serve the prototype')
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/places-waiting.png', fullPage: true })

    // Stopped from here, the place frees and the waiting task starts on its own.
    await page.getByRole('dialog', { name: 'Keeping a place' }).getByRole('button', { name: /^Stop/ }).click()
    await expect(page.getByText(/^Waiting: /)).toHaveCount(0)
    await expect(pill).toHaveCount(0)
    await expect(page.getByText('Ready', { exact: true })).toHaveCount(2)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/places-started.png', fullPage: true })
  } finally {
    await electronApp.close()
  }
})
