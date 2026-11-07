import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, projectSettings, still } from './support'

/*
 * The coordinator as a project switch, and While you were away (ADR-097),
 * in a real window with the fake agents. Turned off in General, the
 * project's Conversation says so with Turn it on, its composer reads
 * Describe a task with Auto for its lead, and the empty Up next offers New
 * task. What the person writes starts a task at once; its lead starts
 * another, and that is on the board, over the lanes. Each state is shot in
 * light and dark (test-results/coordinator-off-*.png).
 */

const shoot = async (page: Page, name: string, what?: Locator) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    await still(page)
    const path = `test-results/coordinator-off-${name}-${scheme}.png`
    if (what === undefined) await page.screenshot({ path, scale: 'css', animations: 'disabled' })
    else await what.screenshot({ path, scale: 'css', animations: 'disabled' })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test('off, the composer starts a task with Auto, and the board says what its lead did outside its worktree', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await (await electronApp.browserWindow(page)).evaluate((window) => window.setSize(1280, 800))

    // Turned off in the project's General settings.
    await projectSettings(page, 'General')
    const turned = page.getByRole('switch', { name: 'Use the coordinator' })
    await expect(turned).toBeChecked()
    await turned.click()
    await expect(turned).not.toBeChecked()
    // Its row: the innermost that holds both its switch and what it says.
    const row = page.locator('div').filter({ has: turned, hasText: 'Off, what you write' }).last()
    await shoot(page, 'setting', row)

    // The project: the Conversation says it is off, the composer describes a task with Auto, and Up next offers New task.
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Home' }).click()
    await expect(page.getByText(/^The coordinator is off in /)).toBeVisible()
    const box = page.getByRole('textbox', { name: /Describe a task/ })
    await expect(box).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lead: Auto' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New task' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Talk to the coordinator' })).toHaveCount(0)
    await shoot(page, 'project')

    // New task puts the person in the composer; what they write starts a task at once, and its lead starts another.
    await page.getByRole('button', { name: 'New task' }).click()
    await expect(box).toBeFocused()
    await box.fill('Tidy the docs\nSplit the changelog out [lead:start-task]')
    await box.press('Enter')
    const away = page.getByRole('region', { name: 'While you were away' })
    await expect(away.getByText('Started “Split the changelog out”')).toBeVisible()
    await expect(away.getByRole('button', { name: /Tidy the docs/ })).toBeVisible()
    await shoot(page, 'away')
    await shoot(page, 'away-list', away)

    // × clears it: the next list starts from now.
    await away.getByRole('button', { name: 'Clear' }).click()
    await expect(away).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
