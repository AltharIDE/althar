import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, still } from './support'

/*
 * A small change starts at once, and its card still lets the person pick its team: Change the team… is there from the
 * moment the card appears, and what is saved shows on the card. Its screenshots (test-results/small-team-*.png) are
 * this change's own evidence.
 */

test('changes the team of a small change from its card', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  mkdirSync(join(home, 'profile'), { recursive: true })
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800))
    await openFirstProject(electronApp, page, repository(home))
    // A lead that never ends its turn: the small change is at work while its team changes.
    await say(page, 'Fix a typo in the run menu. [coordinator:plan] [coordinator:plan-small] [lead:wait]')
    await page.getByRole('button', { name: /Open task/ }).click()
    const change = page.getByRole('button', { name: 'Change the team…' })
    await expect(change).toBeVisible()
    await page.mouse.move(1180, 780)
    await still(page)
    const card = change.locator('xpath=ancestor::*[@data-rhythm][1]')
    await card.screenshot({ path: 'test-results/small-team-card.png', scale: 'css', animations: 'disabled' })

    await change.click()
    const dialog = page.getByRole('dialog', { name: /team/i })
    await expect(dialog.getByRole('button', { name: /^Implement:/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start' })).toHaveCount(0)
    await expect(dialog.getByText('From its next turn.')).toBeVisible()
    await page.mouse.move(1180, 780)
    await still(page)
    await dialog.screenshot({ path: 'test-results/small-team-dialog.png', scale: 'css', animations: 'disabled' })

    await dialog.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'Remove from this step' }).click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(/no review/).first()).toBeVisible()
    await page.mouse.move(1180, 780)
    await still(page)
    await card.screenshot({ path: 'test-results/small-team-saved.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
