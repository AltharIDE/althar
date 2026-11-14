import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, showPanes, shown, toConversation } from './support'

/*
 * A small change's review after it merges, under Major only (the default), in a real window: its reviewer reports a minor
 * finding and a nit, so the review ends as one quiet line in the task's thread ("… · 2 findings · None major"), its findings
 * there when it opens, and nothing waits on the person: no Fix it, no Leave it, nothing in Needs you. The screenshots it
 * takes are this change's own evidence (test-results/after-merge-quiet-*.png).
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

test('a small change’s review after its merge with only minor findings ends as a quiet line, its findings readable', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    // A small change starts at once. Its after-merge review is an explicit request below, independent of its size.
    await say(
      page,
      'Add a retry. [coordinator:plan] [coordinator:plan-small] [coordinator:plan-no-review] [lead:finish] [lead:edit] [review:always]',
    )
    await expect(page.getByText('PR #1')).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    const composer = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
    const reviewer = JSON.stringify({ part: 'checked_by', review: { agent: 'codex' }, why: 'the person asked' })
    const after = JSON.stringify({ review: 'review', why: 'the person asked' })
    await composer.fill(
      `Have Codex review this after it merges. [lead:call change_part ${reviewer}] [lead:call review_after_merge ${after}]`,
    )
    await composer.press('Enter')
    await expect(shown(page, /Its lead kept a review after the merge/).first()).toBeVisible()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    await page.getByRole('button', { name: 'Mark ready for review' }).click()
    await page.getByRole('button', { name: 'Accept and merge' }).click()
    const clone = mkdtempSync(join(tmpdir(), 'althar-e2e-merge-'))
    execFileSync('git', ['clone', '-q', remote, clone])
    git(clone, 'merge', '-q', '--squash', 'origin/althar/add-a-retry')
    git(clone, 'commit', '-q', '-m', 'Merge althar/add-a-retry')
    git(clone, 'push', '-q', 'origin', 'main')

    // Its reviewer reads what merged and finds a minor thing and a nit: one quiet line, closed.
    // Its outputs don't say changes were asked: nothing was.
    await expect(page.getByText('Reviewed by')).toBeVisible()
    await expect(page.getByText('Changes asked by')).toHaveCount(0)
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Conversation/ })
      .click()
    const line = page.locator('[data-review]').filter({ hasText: '2 findings' }).last()
    await expect(line).toContainText('None major')
    await expect(page.getByRole('button', { name: 'Fix it' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Leave it' })).toHaveCount(0)
    await line.scrollIntoViewIfNeeded()
    await line.screenshot({ path: 'test-results/after-merge-quiet-line.png', animations: 'disabled', scale: 'css' })

    // Opened, its findings are there to read.
    await line.getByRole('button').first().click()
    await expect(line).toContainText('minor', { ignoreCase: true })
    await expect(line).toContainText('nit', { ignoreCase: true })
    await line.screenshot({ path: 'test-results/after-merge-quiet-open.png', animations: 'disabled', scale: 'css' })

    // On the board it waits on nobody: settled, not in Needs you.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await showPanes(page, { conversation: false, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByText('PR #1 merged')).toBeVisible()
    await expect(work.getByText(/Review found/)).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
