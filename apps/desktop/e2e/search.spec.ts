import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask } from './support'

test('searches real task text and files, morphs into actions without emptying, and keeps the coordinator draft', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-search-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await startTask(page, 'Add a retry to checkout', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.keyboard.press('Meta+k')
    const dialog = page.getByRole('dialog', { name: 'Search' })
    const field = dialog.getByRole('combobox')
    await field.fill('retry')
    const task = dialog.getByRole('option', { name: /Add a retry to checkout/ }).first()
    await expect(task).toBeVisible()
    await dialog.screenshot({ path: 'test-results/search-light.png', scale: 'css' })
    await field.press('ArrowRight')
    await expect(dialog.getByRole('option', { name: 'Copy', exact: true })).toBeVisible()
    // No real row or chip is hidden for the length of a spring.
    expect(await dialog.locator('[data-chip]').evaluate((el) => getComputedStyle(el).visibility)).toBe('visible')
    await field.press('Escape')
    await expect(task).toBeVisible()
    await field.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rename: Add a retry to checkout', exact: true })).toBeVisible()
    // What a lead said is found by the id search carries: its round names every message it shows.
    await expect(page.locator('article[data-items]:not([data-items=""])').first()).toBeAttached()
    await page.keyboard.press('Meta+k')
    await field.fill('/README')
    await expect(dialog.getByRole('option', { name: /README/ }).first()).toBeVisible()
    await field.press('Escape')
    await field.press('Escape')
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.keyboard.press('Meta+k')
    await field.fill('retry')
    await expect(task).toBeVisible()
    await dialog.screenshot({ path: 'test-results/search-dark.png', scale: 'css' })
    await field.press('Tab')
    await field.fill('Why do we retry checkout?')
    await field.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Tell the coordinator something' })).toContainText('Why do we retry checkout?')
    expect(errors).toEqual([])
  } finally {
    await electronApp.close()
  }
})
