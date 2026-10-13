import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask } from './support'

/*
 * Renaming a task from its header: pressing the title edits it where it is,
 * Escape puts it back, Enter keeps it; the new title shows on the board too,
 * The screenshots are this
 * change's own evidence (test-results/rename-*.png).
 */

test('renames a task from its header, and the new title shows everywhere', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Open task/ }).click()
    const title = page.getByRole('heading', { name: 'Keep the session alive', level: 1 })
    await expect(title).toBeVisible()
    await page.screenshot({ path: 'test-results/rename-1-header.png', animations: 'disabled' })

    // Escape puts it back.
    await title.getByRole('button').click()
    const field = page.getByRole('textbox', { name: 'Rename' })
    await expect(field).toBeFocused()
    await field.fill('Something else')
    await page.keyboard.press('Escape')
    await expect(title).toBeVisible()

    // Enter keeps what was typed, while the task runs.
    await title.getByRole('button').click()
    await field.fill('Keep the session alive across a restart')
    await page.screenshot({ path: 'test-results/rename-2-editing.png', animations: 'disabled' })
    await page.keyboard.press('Enter')
    const renamed = page.getByRole('heading', { name: 'Keep the session alive across a restart', level: 1 })
    await expect(renamed).toBeVisible()
    await page.screenshot({ path: 'test-results/rename-3-renamed.png', animations: 'disabled' })

    // From the menu too.
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: /Rename/ }).click()
    await expect(page.getByRole('textbox', { name: 'Rename' })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Back to/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await expect(page.getByText('Keep the session alive across a restart').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Keep the session alive across a restart', level: 1 })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/rename-4-project.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
