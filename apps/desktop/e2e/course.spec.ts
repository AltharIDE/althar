import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say } from './support'

/*
 * A task's course from its menu (DEV-31): stopped in the middle of its step,
 * resumed, abandoned after saying what stays, and reopened; and a held plan
 * whose countdown restarts. The lead is the scripted fake, which works until
 * it is stopped (`[lead:wait]`).
 */

const menu = async (page: Page) => {
  await page.getByRole('button', { name: 'More for this task' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  return page.getByRole('menu')
}

test('stops, resumes, abandons and reopens a task from its menu, and restarts a held plan’s countdown', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Keep the session alive')
    await page.getByLabel('Anything the lead should know').fill('[lead:wait]')
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByText('Implementing', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    // Working: stop it, or abandon it; nothing to resume.
    let items = await menu(page)
    await expect(items.getByRole('menuitem', { name: /Resume/ })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/course-working-menu.png', animations: 'disabled' })
    await items.getByRole('menuitem', { name: /Stop the task/ }).click()
    await expect(page.getByText('Stopped', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    // Nothing waits on the person for it.
    await expect(page.getByText('Needs you', { exact: true })).toHaveCount(0)

    // Stopped in the middle of its step: resume it, and the lead carries it on.
    items = await menu(page)
    await expect(items.getByRole('menuitem', { name: /Stop the task/ })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/course-stopped-menu.png', animations: 'disabled' })
    await items.getByRole('menuitem', { name: /Resume/ }).click()
    await expect(page.getByText('Implementing', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    // Abandoned after saying what stays, it says so where it stood.
    items = await menu(page)
    await items.getByRole('menuitem', { name: /Abandon/ }).click()
    const asked = page.getByRole('dialog', { name: 'Abandon this task?' })
    await expect(asked).toContainText('The agents on it stop.')
    await expect(asked).toContainText(/Its branch althar\/keep-the-session-alive stays\. Nothing is pushed or deleted\./)
    await page.screenshot({ path: 'test-results/course-abandon-dialog.png', animations: 'disabled' })
    await asked.getByRole('button', { name: 'Abandon task' }).click()
    await expect(asked).toHaveCount(0)
    await expect(page.getByText('Abandoned', { exact: true }).first()).toBeVisible()

    // Reopened, it is stopped where it was, ready to resume.
    items = await menu(page)
    await expect(items.getByRole('menuitem', { name: /Abandon/ })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/course-abandoned-menu.png', animations: 'disabled' })
    await items.getByRole('menuitem', { name: /Reopen/ }).click()
    await expect(page.getByText('Stopped', { exact: true }).first()).toBeVisible()
    items = await menu(page)
    await expect(items.getByRole('menuitem', { name: /Resume/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)

    // Back in the project, a plan the coordinator proposes, held, counts down again when let go.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await say(page, 'Add a retry to the checkout call. [coordinator:plan] [lead:finish]')
    await expect(page.getByText(/^Starts in \d+s$/)).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Hold' }).click()
    await expect(page.getByText('Held. Starts when you say')).toBeVisible()
    await page.screenshot({ path: 'test-results/course-held-plan.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Restart the countdown' }).click()
    await expect(page.getByText(/^Starts in \d+s$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hold' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
