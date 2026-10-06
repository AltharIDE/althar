import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch } from './support'

/*
 * The home, once there are projects: what waits on you, what runs, and what
 * the loop did, across projects, with the projects beside it; settings for
 * the agents and connections.
 */

/** Plans a task in the open project with no review, as the person would, and starts it. */
const startTask = async (page: Page, title: string, lead: string) => {
  await page.getByRole('button', { name: 'New task' }).click()
  await page.getByLabel('What should change').fill(title)
  await page.getByLabel('Anything the lead should know').fill(lead)
  await page.getByRole('button', { name: /^Review:/ }).click()
  await page.getByRole('button', { name: 'No review' }).click()
  await page.getByRole('button', { name: 'Start the task' }).click()
}

test('comes back to what runs and what waits across projects, with the projects beside it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const halyard = repository(home, 'halyard')
  const { electronApp, page } = await launch(home)
  try {
    // A task that keeps working in one project.
    await chooseFolder(electronApp, meridian)
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Retry the checkout call', '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Home' }).click()

    // The home has it running, and the project beside it.
    const projects = page.getByRole('complementary', { name: 'Projects' })
    await expect(projects.getByRole('button', { name: /meridian/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry the checkout call' })).toBeVisible()

    // Another project, opened from the home, with a task that is soon ready.
    await chooseFolder(electronApp, halyard)
    await page.getByRole('button', { name: 'Open a folder' }).click()
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()
    await startTask(page, 'Name the limits better', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Home' }).click()

    // Ready to accept is what needs you; what the lead did shows since you looked.
    await expect(page.getByRole('heading', { name: 'Name the limits better', level: 3 })).toBeVisible()
    await expect(page.getByText('Implement finished')).toBeVisible()
    await expect(projects.getByRole('button', { name: /halyard/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/home.png' })

    // Review opens it in the dock, in the projects' place.
    await page.getByRole('button', { name: 'Review' }).click()
    await expect(page.getByRole('button', { name: 'Merge into main' })).toBeVisible()
    await expect(projects).toHaveCount(0)
    await page.screenshot({ path: 'test-results/home-dock.png' })
    await page.getByRole('button', { name: 'Merge into main' }).click()
    await expect(page.getByRole('heading', { name: 'Name the limits better', level: 3 })).toHaveCount(0)

    // Settings hold the agents and their accounts, and the connections.
    await page.keyboard.press('Meta+,')
    await expect(page.getByRole('heading', { name: 'Agents on this Mac' })).toBeVisible()
    await expect(page.getByText('Claude Code')).toBeVisible()
    await page.screenshot({ path: 'test-results/settings.png' })
    await page.getByRole('button', { name: 'Home' }).click()
    await expect(projects.getByRole('button', { name: /meridian/ })).toBeVisible()

    // ⌘1 opens the first project.
    await page.keyboard.press('Meta+1')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
