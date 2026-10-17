import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * Plan usage, from the bar and from the key. The fake agents have accounts
 * but no plan to read, so this checks the way to the view and what it says
 * of an account with no numbers, not the numbers themselves.
 */

test('opens plan usage from the bar and from Control-U (⌘U on a Mac), and closes it again', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // Always in the window's bar.
    await page.getByRole('button', { name: /^Usage/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Plan usage' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Read again' })).toBeVisible()
    await page.screenshot({ path: 'test-results/plan-usage.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // The key opens it, and the same key closes it.
    const key = process.platform === 'darwin' ? 'Meta+u' : 'Control+u'
    await page.keyboard.press(key)
    await expect(dialog).toBeVisible()
    await page.keyboard.press(key)
    await expect(dialog).toBeHidden()
  } finally {
    await electronApp.close()
  }
})
