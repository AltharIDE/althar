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
    await page.keyboard.press('ControlOrMeta+k')
    const dialog = page.getByRole('dialog', { name: 'Search' })
    const field = dialog.getByRole('combobox')
    await field.fill('retry')
    const task = dialog.getByRole('option', { name: /Add a retry to checkout/ }).first()
    await expect(task).toBeVisible()
    await expect(task).toHaveAttribute('aria-selected', 'true')
    await dialog.screenshot({ path: 'test-results/search-light.png', scale: 'css' })
    // The index may still be filling in under the first keystroke, which ranks again; → lists the actions once the top hit is chosen.
    await expect(async () => {
      await expect(task).toHaveAttribute('aria-selected', 'true')
      await field.press('ArrowRight')
      await expect(dialog.getByRole('option', { name: 'Copy', exact: true })).toBeVisible()
    }).toPass()
    // No real row or chip is hidden for the length of a spring.
    expect(await dialog.locator('[data-chip]').evaluate((el) => getComputedStyle(el).visibility)).toBe('visible')
    await field.press('Escape')
    await expect(task).toBeVisible()
    await field.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rename: Add a retry to checkout', exact: true })).toBeVisible()
    // What a lead said is found by the id search carries: its round names every message it shows.
    const round = page.locator('article[data-items]:not([data-items=""])').first()
    await expect(round).toBeAttached()
    // Searching a sentence the lead said brings the person to the block that holds it, and focuses it.
    const sentence = (await round.locator('p').last().innerText()).split(/\s+/).slice(0, 4).join(' ')
    await page.keyboard.press('ControlOrMeta+k')
    await field.fill(`"${sentence}`)
    await dialog.getByRole('option').first().waitFor()
    await field.press('Enter')
    await expect(dialog).toHaveCount(0)
    const focused = page.locator('article[data-items]:focus')
    await expect(focused).toHaveCount(1)
    await expect(focused).toContainText(sentence)
    expect((await focused.getAttribute('data-items'))!.length).toBeGreaterThan(0)
    await page.keyboard.press('ControlOrMeta+k')
    await field.fill('/README')
    await expect(dialog.getByRole('option', { name: /README/ }).first()).toBeVisible()
    await field.press('Escape')
    await field.press('Escape')
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.keyboard.press('ControlOrMeta+k')
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
