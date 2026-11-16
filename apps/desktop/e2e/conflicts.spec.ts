import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, launch, openFirstProject, projectSettings, startTask, still, toConversation, showPanes } from './support'

/*
 * A conflict is never left without a word (ADR-030), in a real window with
 * the fake agent: a task's branch stops merging with main, its project's
 * leads resolving conflicts as they do unless the person turned it off, and
 * its settings offering to look at every task again; its lead can't resolve
 * it (`[lead:resolve-fails]`),
 * and its card and its task say why; its task, which the card opens, with
 * Resolve now, which asks the lead again though nothing moved (DEV-173). The screenshots it takes are this
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

    // On unless the person turned it off (ADR-092), every open task can be looked at again from there.
    await projectSettings(page, 'Tasks')
    const conflicts = page.getByRole('switch', { name: 'Resolve merge conflicts automatically' })
    await expect(conflicts).toBeChecked()
    await page.getByRole('button', { name: 'Look for conflicts now' }).click()
    await expect(page.getByText('Looking…')).toBeVisible()
    // The innermost of what holds both the switch and its note: the setting's row.
    await page
      .locator('*', { has: conflicts, hasText: 'Looking…' })
      .last()
      .screenshot({ path: 'test-results/conflicts-settings.png', animations: 'disabled', scale: 'css' })
    await backToWork(page)

    // The lead couldn't resolve it: the card says why, and opens its task, as asking again from it asks what the lead couldn't do.
    await showPanes(page, { conversation: false, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })
    const card = work.getByRole('article').filter({ hasText: 'Add a retry' })
    await expect(card.getByText('Merge conflict')).toBeVisible()
    await expect(card.getByText(/The lead couldn’t resolve the conflict with main/)).toBeVisible()
    await expect(card.getByRole('button', { name: 'Resolve now' })).toHaveCount(0)
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

test('quitting while the lead merges a conflict keeps its merge and completes recovery after reopening', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const first = await launch(home)
  let worktree = ''
  let mergedHead = ''
  try {
    await openFirstProject(first.electronApp, first.page, repo)
    await startTask(first.page, 'Add a retry', '[lead:finish] [lead:edit] [lead:resolve-hold]')
    await expect(first.page.getByText('Ready', { exact: true })).toBeVisible()
    const task = git(repo, 'worktree', 'list', '--porcelain')
      .split('\n\n')
      .find((one) => one.includes('branch refs/heads/') && !one.includes('branch refs/heads/main'))
    worktree = task?.split('\n')[0]?.slice('worktree '.length) ?? ''
    expect(worktree).not.toBe('')
    writeFileSync(join(repo, 'change.txt'), 'main’s own change\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'Main moves on')
    await projectSettings(first.page, 'Tasks')
    await first.page.getByRole('button', { name: 'Look for conflicts now' }).click()
    // The fake lead commits the conflict merge and holds its turn before reporting it done.
    await expect
      .poll(() => {
        try {
          git(worktree, 'merge-base', '--is-ancestor', 'main', 'HEAD')
          return true
        } catch {
          return false
        }
      })
      .toBe(true)
    mergedHead = git(worktree, 'rev-parse', 'HEAD')
  } finally {
    await first.electronApp.close()
  }
  const before = new DatabaseSync(join(home, 'profile', 'althar.sqlite'), { readOnly: true })
  try {
    expect(before.prepare('SELECT state FROM conflict_resolutions').all()).toEqual([{ state: 'resolving' }])
  } finally {
    before.close()
  }
  const again = await launch(home)
  try {
    await again.page.getByRole('navigation', { name: 'Projects' }).getByText('meridian').click()
    await showPanes(again.page, { conversation: false, board: true })
    const work = again.page.getByRole('region', { name: 'The project’s work' })
    const card = work.getByRole('region', { name: 'Needs you' }).getByRole('article').filter({ hasText: 'Add a retry' })
    await expect(card.getByText('Ready to accept', { exact: true })).toBeVisible()
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(mergedHead)
    await card.screenshot({ path: 'test-results/restarts-merge-recovered.png', scale: 'css' })
  } finally {
    await again.electronApp.close()
  }
  const after = new DatabaseSync(join(home, 'profile', 'althar.sqlite'), { readOnly: true })
  try {
    expect(after.prepare('SELECT state FROM conflict_resolutions').all()).toEqual([{ state: 'resolved' }])
    expect(after.prepare("SELECT count(*) AS n FROM attention_requests WHERE state = 'open'").get()?.n).toBe(0)
  } finally {
    after.close()
  }
})
