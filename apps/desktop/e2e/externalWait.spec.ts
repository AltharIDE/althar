import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, shown, startTask, still } from './support'

test('shows an external wait as work in progress, and Stop cancels it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await startTask(page, 'Watch the deployment', '[lead:wait-for-external]')
    await expect(shown(page, /Waiting: The deployment to finish/).first()).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByRole('heading', { name: /Watch the deployment/, level: 1 })).toBeVisible()
    await expect(shown(page, /Waiting: The deployment to finish/).first()).toBeVisible()
    await expect(shown(page, /next check/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Answer the lead' })).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/external-wait.png', scale: 'css' })
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: /Stop the task/ }).click()
    await expect(shown(page, 'Stopped', { exact: true }).first()).toBeVisible()
    await expect(shown(page, /Waiting: The deployment to finish.*next check/)).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
