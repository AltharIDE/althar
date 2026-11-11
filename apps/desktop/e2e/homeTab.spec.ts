import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

test('keeps Home dismissed across a restart and can reopen it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  let app = await launch(home)
  try {
    await openFirstProject(app.electronApp, app.page, repo)
    const nav = app.page.getByRole('navigation', { name: 'Projects' })
    await nav.getByRole('button', { name: 'Close Home' }).click()
    await expect(nav.getByRole('button', { name: 'Close Home' })).toHaveCount(0)
    await expect(app.page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await app.electronApp.close()
    app = await launch(home)
    const reopened = app.page.getByRole('navigation', { name: 'Projects' })
    await expect(app.page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await expect(reopened.getByRole('button', { name: 'Close Home' })).toHaveCount(0)
    await reopened.screenshot({ path: 'test-results/home-dismissed.png', scale: 'css' })
    await reopened.getByRole('button', { name: /^Home/ }).click()
    await expect(reopened.getByRole('button', { name: 'Close Home' })).toBeVisible()
    await reopened.screenshot({ path: 'test-results/home-reopened.png', scale: 'css' })
  } finally {
    await app.electronApp.close()
  }
})
