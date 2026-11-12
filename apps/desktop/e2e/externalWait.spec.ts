import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, shown, sizeWindow, startTask, still } from './support'

for (const appearance of ['light', 'dark'] as const)
  test(`shows an external wait as work in progress in ${appearance}, and Stop cancels it`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
    mkdirSync(join(home, 'profile'), { recursive: true })
    writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance }))
    const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
    try {
      await openFirstProject(electronApp, page, repository(home))
      await startTask(page, 'Watch the deployment', '[lead:wait-for-external]')
      await expect(shown(page, /Waiting: The deployment to finish/).first()).toBeVisible()
      await page.getByRole('button', { name: /Open task/ }).click()
      await expect(page.getByRole('heading', { name: /Watch the deployment/, level: 1 })).toBeVisible()
      const header = page.getByRole('banner', { name: 'Watch the deployment' })
      await header.getByText('Waiting', { exact: true }).hover()
      await expect(page.getByRole('tooltip')).toContainText('Waiting: The deployment to finish')
      await expect(page.getByRole('tooltip')).toContainText('next check')
      await expect(page.getByRole('button', { name: 'Answer the lead' })).toHaveCount(0)
      await expect(page.locator('html')).toHaveAttribute('data-theme', appearance)
      await still(page)
      await page.screenshot({ path: `test-results/external-wait-${appearance}.png`, scale: 'css' })
      if (appearance === 'light') {
        await sizeWindow(electronApp, page, 880, 700)
        await header.getByText('Waiting', { exact: true }).hover()
        await expect(page.getByRole('tooltip')).toContainText('next check')
        await still(page)
        await page.screenshot({ path: 'test-results/external-wait-narrow.png', scale: 'css' })
      }
      await page.getByRole('button', { name: 'More for this task' }).click()
      await page.getByRole('menuitem', { name: /Stop the task/ }).click()
      await expect(shown(page, 'Stopped', { exact: true }).first()).toBeVisible()
      await expect(header.getByText('Waiting', { exact: true })).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
