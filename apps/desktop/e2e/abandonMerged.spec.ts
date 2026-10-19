import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say } from './support'

/*
 * A merged task with a commit after its pull request, as DEV-58 was (ADR-034):
 * its lead committed after the pull request merged, in no follow-up, having
 * brought main in first. The board keeps it in Needs you, ready for a new
 * pull request, and counts that one commit alone, not what main brought; its
 * menu offers Abandon, as every task's does, and abandoned it is settled
 * again and merged still, the commit left out on its branch. The screenshots
 * it takes are this change's own evidence (test-results/abandon-merged-*.png).
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

test('a merged task with a commit after its pull request needs the person, and abandoning it leaves the commit out', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  const branch = 'althar/cap-parallel-agents-per-machine'
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    // Its plan runs and its pull request opens; accepted, GitHub merges it, squashed into main, and the task settles.
    await say(page, 'Cap parallel agents per machine. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
    await page.getByRole('button', { name: 'Start now' }).click({ timeout: 20_000 })
    await expect(page.getByText('PR #1')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /Open task/ }).click()
    await page.getByRole('button', { name: 'Mark ready for review' }).click()
    await page.getByRole('button', { name: 'Accept and merge' }).click()
    const clone = mkdtempSync(join(tmpdir(), 'althar-e2e-merge-'))
    execFileSync('git', ['clone', '-q', remote, clone])
    git(clone, 'merge', '-q', '--squash', `origin/${branch}`)
    git(clone, 'commit', '-q', '-m', `Merge ${branch}`)
    git(clone, 'push', '-q', 'origin', 'main')
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByText('PR #1 merged')).toBeVisible({ timeout: 10_000 })

    // As DEV-58's lead did, with no follow-up: it brings main in, as this Mac has it, and commits the slider after.
    git(repo, 'pull', '-q', '--ff-only', remote, 'main')
    const worktree =
      git(repo, 'worktree', 'list', '--porcelain')
        .split('\n\n')
        .find((entry) => entry.includes(`branch refs/heads/${branch}`))
        ?.match(/^worktree (.+)$/m)?.[1] ?? ''
    expect(worktree).toContain(home)
    git(worktree, 'merge', '-q', '--no-edit', 'main')
    appendFileSync(join(worktree, 'slider.txt'), 'The notched slider.\n')
    git(worktree, 'add', '-A')
    git(worktree, 'commit', '-q', '-m', 'Agents at once as the agreed notched slider')

    // Read again, as the window reads it after a restart: the board keeps it in Needs you, ready for a new pull request.
    await page.reload()
    const card = work.getByRole('button', { name: 'Cap parallel agents per machine' })
    await expect(work.getByText('Ready for a new pull request')).toBeVisible({ timeout: 20_000 })
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/abandon-merged-board.png', animations: 'disabled', scale: 'css' })

    // Its outputs count that commit alone, not what bringing main in brought.
    await card.click()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    await expect(page.getByText(/after PR #1 isn’t in a pull request yet|after PR #1 aren’t in a pull request yet/)).toBeVisible()
    await page.screenshot({ path: 'test-results/abandon-merged-outputs.png', animations: 'disabled', scale: 'css' })

    // Its menu offers Abandon, which says the task stays merged; asked first, it says what is left out.
    await page.getByRole('button', { name: 'More for this task' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /Abandon/ })).toContainText('Its pull request stays merged.')
    await menu.screenshot({ path: 'test-results/abandon-merged-menu.png', animations: 'disabled', scale: 'css' })
    await menu.getByRole('menuitem', { name: /Abandon/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Abandon this task?' })
    await expect(dialog).toContainText('PR #1 stays merged.')
    await expect(dialog).toContainText('The commit after it goes in no pull request.')
    await dialog.screenshot({ path: 'test-results/abandon-merged-dialog.png', animations: 'disabled', scale: 'css' })
    await dialog.getByRole('button', { name: 'Abandon task' }).click()

    // Abandoned, it is settled again and merged still, the commit on its branch, and the thread says so.
    await expect(page.getByText('One commit after PR #1 isn’t in a pull request yet.')).toHaveCount(0, { timeout: 10_000 })
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Conversation/ })
      .click()
    await expect(page.getByText('Abandoned 1 commit after PR #1.')).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/abandon-merged-left.png', animations: 'disabled', scale: 'css' })
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(work.getByText('Ready for a new pull request')).toHaveCount(0)
    await expect(work.getByText('PR #1 merged')).toBeVisible({ timeout: 10_000 })
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/abandon-merged-settled-board.png', animations: 'disabled', scale: 'css' })
    expect(git(worktree, 'log', '-1', '--format=%s')).toBe('Agents at once as the agreed notched slider')
  } finally {
    await electronApp.close()
  }
})
