import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, launch, openFirstProject, projectSettings, startTask, still, toConversation } from './support'

/*
 * A conflict is never left without a word (ADR-030), in a real window with
 * the fake agent: a task's branch stops merging with main, the project's
 * leads are told to resolve conflicts from its settings, which then offer to
 * look at every task again; its lead can't resolve it (`[lead:resolve-fails]`),
 * and its card and its task say why, each with Resolve now, which asks the
 * lead again though nothing moved. The screenshots it takes are this
 * change's own evidence (test-results/conflicts-*.png).
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

test('a conflict its lead couldn’t resolve says why on its card and in its task, and Resolve now asks again', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const repo = repository(projects)
  const { electronApp, page } = await launch(home)
  try {
    await (await electronApp.browserWindow(page)).evaluate((w) => w.setSize(1280, 820))
    await openFirstProject(electronApp, page, repo)
    await startTask(page, 'Add a retry', '[lead:finish] [lead:edit] [lead:resolve-fails]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()

    // Main moves on in the file the task changed: its branch no longer merges cleanly.
    writeFileSync(join(repo, 'change.txt'), 'main’s own change\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'Main moves on')

    // Turned on, what already conflicts is looked at now; and every open task can be looked at again from there.
    await projectSettings(page, 'General')
    const conflicts = page.getByRole('switch', { name: 'Resolve merge conflicts automatically' })
    await conflicts.click()
    await expect(conflicts).toBeChecked()
    await page.getByRole('button', { name: 'Look for conflicts now' }).click()
    await expect(page.getByText('Looking…')).toBeVisible()
    // The innermost of what holds both the switch and its note: the setting's row.
    await page
      .locator('*', { has: conflicts, hasText: 'Looking…' })
      .last()
      .screenshot({ path: 'test-results/conflicts-settings.png', animations: 'disabled', scale: 'css' })
    await backToWork(page)

    // The lead couldn't resolve it: the card says why, with Resolve now.
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const card = work.getByRole('article').filter({ hasText: 'Add a retry' })
    await expect(card.getByText('Merge conflict')).toBeVisible()
    await expect(card.getByText(/The lead couldn’t resolve the conflict with main/)).toBeVisible()
    await expect(card.getByRole('button', { name: 'Resolve now' })).toBeVisible()
    await still(page)
    await card.screenshot({ path: 'test-results/conflicts-card.png', animations: 'disabled', scale: 'css' })

    // In its task, over the composer, the same, with Resolve now.
    await card.click()
    await toConversation(page)
    const line = page.getByText(/The lead couldn’t resolve the conflict with main/).last()
    await expect(line).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/conflicts-task.png', animations: 'disabled', scale: 'css' })

    // Resolve now asks the lead again, though neither main nor the branch moved: it can't, and says so once more.
    const said = page.getByText(/^Couldn.t settle the conflict: both sides change the same lines\.$/)
    const before = await said.count()
    await page.getByRole('button', { name: 'Resolve now' }).click()
    await expect.poll(() => said.count()).toBeGreaterThan(before)
  } finally {
    await electronApp.close()
  }
})
