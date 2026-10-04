import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch } from './support'

/*
 * A project's rules (ADR-013), as the person changes them: from the
 * project's title bar, each change kept at once, there again when they
 * come back.
 */

test('changes a project’s rules from its title bar, and keeps them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await chooseFolder(electronApp, repo)
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Project rules' }).click()
    await expect(page.getByRole('radio', { name: /Allow, except what you keep/ })).toBeChecked()
    await page.screenshot({ path: 'test-results/rules-top.png', animations: 'disabled' })

    const always = page.getByRole('group', { name: 'Always ask me' })
    await expect(always.getByRole('checkbox', { name: 'Force pushes' })).toBeChecked()
    await always.getByRole('checkbox', { name: 'Force pushes' }).click()
    await page.getByRole('group', { name: 'Never' }).getByRole('checkbox', { name: 'Force pushes' }).click()
    await page.getByRole('button', { name: 'Add a rule' }).first().click()
    await page.getByRole('textbox', { name: 'A command, as it starts' }).fill('terraform *')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(always.getByRole('checkbox', { name: 'Running terraform *' })).toBeChecked()
    await page.getByRole('radio', { name: /Push the branch only/ }).click()
    await page.screenshot({ path: 'test-results/rules.png', animations: 'disabled', fullPage: true })

    // Back to the project and in again: as it was left.
    await page.getByRole('button', { name: /meridian/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Project rules' }).click()
    await expect(page.getByRole('group', { name: 'Always ask me' }).getByRole('checkbox', { name: 'Force pushes' })).not.toBeChecked()
    await expect(page.getByRole('group', { name: 'Never' }).getByRole('checkbox', { name: 'Force pushes' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Running terraform *' })).toBeChecked()
    await expect(page.getByRole('radio', { name: /Push the branch only/ })).toBeChecked()
  } finally {
    await electronApp.close()
  }
})
