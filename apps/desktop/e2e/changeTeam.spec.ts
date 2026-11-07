import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask, still } from './support'

/*
 * The team of a task at work changes from its ••• menu: its plan had no review, so the dialog offers one to add; saved,
 * the thread says what changed. Its screenshots (test-results/team-*.png) are this change's own evidence.
 */

for (const appearance of ['light', 'dark'] as const) {
  test(`changes the team of a running task from its menu, in ${appearance}`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
    mkdirSync(join(home, 'profile'), { recursive: true })
    writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance }))
    const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
    try {
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800))
      await openFirstProject(electronApp, page, repository(home))
      // A lead that never ends its turn: the task is at work while its team changes.
      await startTask(page, 'Add a retry to checkout', '[lead:wait]')
      await page.getByRole('button', { name: /Open task/ }).click()

      await page.getByRole('button', { name: 'More for this task' }).click()
      const menu = page.getByRole('menu')
      await expect(menu.getByRole('menuitem', { name: 'Change the team…' })).toBeVisible()
      await page.mouse.move(1180, 780)
      await still(page)
      await menu.screenshot({ path: `test-results/team-menu-${appearance}.png`, scale: 'css', animations: 'disabled' })
      await menu.getByRole('menuitem', { name: 'Change the team…' }).click()

      const dialog = page.getByRole('dialog', { name: /team/i })
      await expect(dialog.getByRole('button', { name: 'Add a review' })).toBeVisible()
      await expect(dialog.getByText('From its next turn.')).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Start' })).toHaveCount(0)
      await dialog.getByRole('button', { name: 'Add a review' }).click()
      await page.mouse.move(1180, 780)
      await still(page)
      await dialog.screenshot({ path: `test-results/team-dialog-${appearance}.png`, scale: 'css', animations: 'disabled' })

      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByText(/^You changed the review to /)).toBeVisible()
      await page.mouse.move(1180, 780)
      await still(page)
      await page.screenshot({ path: `test-results/team-saved-${appearance}.png`, scale: 'css', animations: 'disabled' })
    } finally {
      await electronApp.close()
    }
  })
}
