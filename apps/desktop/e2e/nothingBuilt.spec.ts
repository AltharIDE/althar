import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask, still } from './support'

/*
 * A change whose lead built nothing: no commits on its branch, no pull
 * request. Its card and header say Nothing built, not Ready to accept, and
 * Done settles it where it is, with no Accept and no merge. Its shots are
 * test-results/nothing-built-*.png.
 */

for (const appearance of ['light', 'dark'] as const) {
  test(`says Nothing built, not Ready to accept, on its board card and in its header, ${appearance}`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
    const projects = join(home, 'Projects')
    mkdirSync(projects)
    mkdirSync(join(home, 'profile'), { recursive: true })
    writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance }))
    const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
    try {
      await openFirstProject(electronApp, page, repository(projects))
      await startTask(page, 'Plan usage shows what is left on OpenCode Zen', '[lead:finish]')
      await expect(page.getByText('Ready', { exact: true })).toBeVisible()
      await page.getByRole('radio', { name: 'Home' }).click()
      const work = page.getByRole('region', { name: 'The project’s work' })
      await expect(work.getByText('Nothing built', { exact: true })).toBeVisible()
      await expect(work.getByText('Ready to accept')).toHaveCount(0)
      await still(page)
      await work
        .getByRole('article')
        .filter({ hasText: 'Nothing built' })
        .screenshot({ path: `test-results/nothing-built-card-${appearance}.png`, scale: 'css' })

      await work.getByRole('article').filter({ hasText: 'Nothing built' }).click()
      await expect(page.getByRole('heading', { name: /Plan usage shows what is left/, level: 1 })).toBeVisible()
      await expect(page.getByText('Nothing built', { exact: true }).locator('visible=true').first()).toBeVisible()
      await expect(page.getByText('Ready to accept').locator('visible=true')).toHaveCount(0)
      await still(page)
      await page.screenshot({
        path: `test-results/nothing-built-header-${appearance}.png`,
        scale: 'css',
        clip: { x: 0, y: 0, width: 1100, height: 110 },
      })
    } finally {
      await electronApp.close()
    }
  })
}

test('settles it as Done from its board card, with no pull request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await startTask(page, 'Plan usage shows what is left on OpenCode Zen', '[lead:finish]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const card = work.getByRole('article').filter({ hasText: 'Nothing built' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    await card.hover()
    await card.getByRole('button', { name: 'Done' }).click()
    await expect(work.getByText('Nothing built', { exact: true })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
