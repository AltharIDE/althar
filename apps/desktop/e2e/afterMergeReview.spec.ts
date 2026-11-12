import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, projectSettings } from './support'

/*
 * What a small change's review after it merges brings back, in a real window: the project's Tasks settings show it under How
 * they go, Major only to start with, and keep another choice; Althar's Settings › Tasks show what new projects start with. In
 * light and dark. The screenshots it takes are this change's own evidence (test-results/after-merge-*.png).
 */

const ROW = 'Review after a small change merges'

const shoot = (page: Page, region: string, name: string) =>
  page
    .getByRole('region', { name: region })
    .screenshot({ path: `test-results/after-merge-${name}.png`, scale: 'css', animations: 'disabled' })

test('the review after a small change merges is a project rule with a default for new projects, in light and dark', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  mkdirSync(join(home, 'profile'), { recursive: true })
  writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance: 'light' }))
  const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
  try {
    await page.setViewportSize({ width: 1180, height: 900 })
    await openFirstProject(electronApp, page, repository(home))
    await projectSettings(page, 'Tasks')
    const go = page.getByRole('region', { name: 'How they go' })
    const select = go.getByRole('combobox', { name: ROW })
    await expect(select).toHaveText('Bring back major findings')
    await expect(go.getByText('Minor findings and nits stay in the task’s thread.')).toBeVisible()
    await shoot(page, 'How they go', 'project-light')
    // Another choice holds, and says what it means under its line.
    await select.click()
    await page.getByRole('option', { name: 'Don’t review it' }).click()
    await expect(go.getByText('Make it a full task to have it reviewed before it merges.')).toBeVisible()
    await page.getByRole('option').first().waitFor({ state: 'detached' })
    await shoot(page, 'How they go', 'project-none-light')

    // Althar's own: what new projects start with, Major only, and this project shown as another.
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Tasks/ })
      .click()
    const projects = page.getByRole('main').getByRole('region', { name: 'New projects' })
    await expect(projects.getByRole('combobox', { name: ROW })).toHaveText('Bring back major findings')
    await shoot(page, 'New projects', 'defaults-light')

    // Dark.
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Appearance' }).click()
    await page.getByRole('main').getByRole('radiogroup', { name: 'Light or dark' }).getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Tasks/ })
      .click()
    await expect(projects.getByRole('combobox', { name: ROW })).toBeVisible()
    await shoot(page, 'New projects', 'defaults-dark')
    const tabs = page.getByRole('navigation', { name: 'Projects' })
    await tabs.getByRole('button', { name: 'Close Settings' }).click()
    await tabs.getByRole('button', { name: /^meridian/ }).click()
    await projectSettings(page, 'Tasks')
    await expect(page.getByRole('region', { name: 'How they go' }).getByRole('combobox', { name: ROW })).toHaveText('Don’t review it')
    await shoot(page, 'How they go', 'project-dark')
  } finally {
    await electronApp.close()
  }
})
