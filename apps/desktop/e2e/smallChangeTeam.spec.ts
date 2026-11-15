import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, still } from './support'

/*
 * A small change starts at once, and its card still lets the person pick its team: Change the team… is on its card in the
 * coordinator's thread and, once it is open, on its card in its own, from the moment either appears. A lead's effort
 * saved from the dialog shows on both. Its screenshots (test-results/small-team-*.png) are this change's own evidence.
 */

test('changes the team of a small change from its card', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  mkdirSync(join(home, 'profile'), { recursive: true })
  writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance: 'light' }))
  const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800))
    await openFirstProject(electronApp, page, repository(home))
    // A lead that never ends its turn: the small change is at work while its team changes.
    await say(page, 'Fix a typo in the run menu. [coordinator:plan] [coordinator:plan-small] [lead:wait]')

    // In the coordinator's thread, with no need to open the task first.
    const change = page.getByRole('button', { name: 'Change the team…' })
    await expect(change).toBeVisible()
    const coordinatorCard = change.locator('xpath=ancestor::article[1]')
    await page.mouse.move(1180, 780)
    await still(page)
    await coordinatorCard.screenshot({ path: 'test-results/small-team-coordinator-card.png', scale: 'css', animations: 'disabled' })

    await change.click()
    const dialog = page.getByRole('dialog', { name: /team/i })
    await expect(dialog.getByRole('button', { name: 'Start' })).toHaveCount(0)
    await expect(dialog.getByText('From its next turn.')).toBeVisible()
    await dialog.getByRole('button', { name: /^Implement:/ }).click()
    await page.getByRole('radio', { name: 'High', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('button', { name: /^Implement:/ })).toHaveAttribute('aria-label', /High$/)
    await page.mouse.move(1180, 780)
    await still(page)
    await dialog.screenshot({ path: 'test-results/small-team-dialog.png', scale: 'css', animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(coordinatorCard).toContainText('High')
    await page.mouse.move(1180, 780)
    await still(page)
    await coordinatorCard.screenshot({ path: 'test-results/small-team-coordinator-saved.png', scale: 'css', animations: 'disabled' })

    // In its own thread: its card names the team it has now.
    await page.getByRole('button', { name: /Open task/ }).click()
    const card = page.locator('[data-rhythm="card"]').filter({ hasText: 'Small change' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('High')
    await page.mouse.move(1180, 780)
    await still(page)
    await card.screenshot({ path: 'test-results/small-team-card.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
