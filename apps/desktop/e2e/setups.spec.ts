import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, launch, openFirstProject, projectSettings, still } from './support'

/*
 * A repository's setup changed in the project's settings, in a real window
 * (ADR-080): typed into Running's lines and kept as the person leaves them,
 * still there once the window reads the project afresh, and an edit the
 * runtime refuses said in a line and put back as it was. The screenshots are
 * this change's own evidence (test-results/setups-*.png).
 */

test('changes a repository’s setup in Running: kept, read back, and a refused edit put back', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await projectSettings(page, 'Running')
    const group = page.getByRole('region', { name: 'Before each task starts' })
    const commands = page.getByRole('textbox', { name: /: commands$/ })
    const files = page.getByRole('textbox', { name: /: files copied from your checkout$/ })
    await expect(commands).toHaveAttribute('placeholder', 'None yet: the first task’s agent sets it.')
    await group.scrollIntoViewIfNeeded()
    await still(page)
    await group.screenshot({ path: '../../test-results/setups-empty.png', scale: 'css' })

    await commands.click()
    await page.keyboard.type('bun install --frozen-lockfile\nbunx playwright install chromium')
    await files.click()
    await page.keyboard.type('.env\n.env.local')
    await page.keyboard.press('Tab')

    // Away to the work and back, then read afresh: the window starts over and asks the runtime.
    await backToWork(page)
    await projectSettings(page, 'Running')
    await expect(commands).toHaveValue('bun install --frozen-lockfile\nbunx playwright install chromium')
    await expect(files).toHaveValue('.env\n.env.local')
    await page.reload()
    await projectSettings(page, 'Running')
    await expect(commands).toHaveValue('bun install --frozen-lockfile\nbunx playwright install chromium')
    await expect(files).toHaveValue('.env\n.env.local')
    await group.scrollIntoViewIfNeeded()
    await still(page)
    await group.screenshot({ path: '../../test-results/setups-kept.png', scale: 'css' })

    // A file outside the repository is refused, said, and the lines go back to what was kept.
    await files.fill('.env\n.env.local\n../secrets.env')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(files).toHaveValue('.env\n.env.local')
    await still(page)
    await group.screenshot({ path: '../../test-results/setups-refused.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
