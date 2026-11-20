import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow } from './support'

/*
 * The Layout group of ⋯ shows or hides the status line along the window's
 * foot: unchecked, it is gone completely, a terminal opened and all; checked,
 * it is back at once; and the choice is kept across launches.
 */

const line = (page: Page) => page.getByLabel('Runs and terminals', { exact: true })
const entry = async (page: Page) => {
  await page.getByRole('button', { name: 'More' }).click()
  return page.getByRole('menuitemcheckbox', { name: /Terminal bar/ })
}

test('the Layout menu hides the terminal bar completely and brings it back', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await sizeWindow(electronApp, page, 1280, 820)
    await openFirstProject(electronApp, page, repo)
    await expect(async () => {
      if ((await line(page).count()) === 0) await page.keyboard.press('Control+Backquote')
      await expect(line(page)).toBeVisible({ timeout: 3000 })
    }).toPass()

    let item = await entry(page)
    await expect(item).toHaveAttribute('aria-checked', 'true')
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'test-results/terminal-bar-before.png', scale: 'css' })
    await item.click()
    await expect(line(page)).toHaveCount(0)

    item = await entry(page)
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'test-results/terminal-bar-after.png', scale: 'css' })
    await item.click()
    await expect(line(page)).toBeVisible()

    // Hidden with its drawer raised, Ctrl+` brings the bar back with the terminal raised, not lowered.
    await expect(page.getByRole('region', { name: 'Runs and terminals drawer' })).toBeVisible()
    await (await entry(page)).click()
    await expect(line(page)).toHaveCount(0)
    await page.keyboard.press('Control+Backquote')
    await expect(page.getByRole('region', { name: 'Runs and terminals drawer' })).toBeVisible()

    // The key t hides it too, when nothing is being typed.
    await page.mouse.click(640, 300)
    await page.keyboard.press('t')
    await expect(line(page)).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
