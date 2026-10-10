import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, say } from './support'

test('connects once, remembers Continue, then opens a project ready for its first request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-onboarding-'))
  const repo = repository(home, 'meridian')
  const first = await launch(home, {}, { onboarding: true })
  try {
    await expect(first.page.getByRole('heading', { name: 'Connect an agent' })).toBeVisible()
    await expect(first.page.getByRole('list', { name: 'Connect an agent' }).getByText('Ready', { exact: true })).toHaveCount(2)
    await expect(first.page.getByRole('button', { name: 'Add an account' })).toHaveCount(0)
    await expect(first.page.getByRole('button', { name: /Open a folder/ })).toHaveCount(0)
    await expect(first.page.locator('canvas')).toHaveCount(0)
    await first.page.screenshot({ path: 'test-results/onboarding-agents.png', animations: 'disabled' })
    await first.page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(first.page.getByRole('heading', { name: 'Open your project' })).toBeVisible()
    await first.page.screenshot({ path: 'test-results/onboarding-project.png', animations: 'disabled' })
  } finally {
    await first.electronApp.close()
  }

  // Even a restart before choosing a project remembers the completed agent step.
  const second = await launch(home, {}, { onboarding: true })
  try {
    await expect(second.page.getByRole('heading', { name: 'Open your project' })).toBeVisible()
    await expect(second.page.getByRole('heading', { name: 'Connect an agent' })).toHaveCount(0)
    await chooseFolder(second.electronApp, repo)
    await second.page.getByRole('button', { name: /Open a folder/ }).click()
    await expect(second.page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await say(second.page, 'hello')
    await expect(second.page.getByRole('article', { name: 'Claude Code', exact: true })).toContainText('hello')
    await second.page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    await expect(second.page.getByRole('complementary', { name: 'Projects' })).toBeVisible()
    await second.page.keyboard.press('Meta+,')
    await expect(second.page.getByRole('button', { name: 'Add an account' })).toHaveCount(2)
  } finally {
    await second.electronApp.close()
  }
})
