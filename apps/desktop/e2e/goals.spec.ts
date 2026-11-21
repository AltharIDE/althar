import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask, still, toConversation } from './support'

test('starts a goal from the task composer and controls it in place', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-goals-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await startTask(page, 'Check the migration')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    const composer = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue|Send now)/ })
    const card = page.getByRole('region', { name: 'Goal' })
    const objective = 'Verify the migration on staging [lead:slowly]'
    await composer.fill('/goal ' + objective)
    await composer.press('Enter')
    await expect(card.getByRole('status')).toHaveText('Active')
    await card.getByRole('button', { name: 'Pause' }).click()
    await expect(card.getByRole('status')).toHaveText('Paused')

    await card.getByRole('button', { name: /Verify the migration/ }).click()
    await card.getByRole('button', { name: 'Edit' }).click()
    await card.getByRole('textbox', { name: 'Objective' }).fill('Verify the migration on local and staging [lead:slowly]')
    await card.getByRole('button', { name: 'Save' }).click()
    await expect(card.getByText('Verify the migration on local and staging [lead:slowly]', { exact: true })).toBeVisible()
    await expect(card.getByRole('status')).toHaveText('Paused')
    await still(page)
    await card.screenshot({ path: 'test-results/goal-paused.png', scale: 'css' })

    await card.getByRole('button', { name: 'Resume' }).click()
    await expect(card.getByRole('status')).toHaveText('Active')
    await card.getByRole('button', { name: 'Clear' }).click()
    await expect(card).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
