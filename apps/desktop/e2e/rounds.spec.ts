import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, toConversation } from './support'

/*
 * A task goes back to work, and ships again (ADR-034), in a real window
 * with the fake agent and the fake GitHub: its pull request merged, the
 * person asks its lead for more, its card says Running on the board while
 * the lead works on its follow-up, and what it committed opens as a second
 * pull request from the task, on a new branch from main. The screenshots it
 * takes are this change's own evidence (test-results/rounds-*.png).
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

/** The host merges a pull request by squashing it into main: its branch stays as it was. */
const squashMerge = (remote: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-e2e-merge-'))
  execFileSync('git', ['clone', '-q', remote, clone])
  git(clone, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, 'commit', '-q', '-m', `Merge ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

/** Connects the fake GitHub from the project's settings, with a token pasted in. */
const connectGitHub = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'meridian’s settings' })
    .getByRole('button', { name: /^GitHub/ })
    .click()
  const connecting = page.getByRole('dialog', { name: 'GitHub' })
  await connecting
    .getByRole('group', { name: 'Ways to connect GitHub' })
    .getByRole('button', { name: /Make a token/ })
    .click()
  await connecting.getByRole('button', { name: 'Paste it myself' }).click()
  await connecting.getByLabel('Paste it').fill('github_pat_e2e')
  await connecting.getByRole('button', { name: 'Check' }).click()
  await expect(connecting.getByRole('heading', { name: 'Connected as you' })).toBeVisible()
  await connecting.getByRole('button', { name: 'Done' }).click()
  await expect(connecting).toHaveCount(0)
}

test('a merged task goes back to work when the person writes to its lead, and ships it as a second pull request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  const branch = 'althar/add-a-retry-to-the-checkout-call'
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    // Its plan runs, and its draft pull request opens; marked ready and accepted, GitHub merges it, squashed into main.
    await say(page, 'Add a retry to the checkout call. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
    await page.getByRole('button', { name: 'Start now' }).click({ timeout: 20_000 })
    await expect(page.getByText('PR #1')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /Open task/ }).click()
    await page.getByRole('button', { name: 'Mark ready for review' }).click()
    await page.getByRole('button', { name: 'Accept and merge' }).click()
    squashMerge(remote, branch)
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByText('PR #1 merged')).toBeVisible({ timeout: 10_000 })

    // The person goes back to it and asks its lead for more: it runs again, a follow-up, on the board and in the task.
    await work.getByRole('button', { name: 'Add a retry to the checkout call' }).click()
    await toConversation(page)
    await say(page, 'Add the slider we agreed on. [lead:slowly] [lead:finish]')
    await expect(page.getByText('Following up', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/rounds-running-task.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(work.getByText('Follow-up', { exact: true })).toBeVisible()
    await expect(work.getByText('PR #1 merged')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/rounds-running-board.png', animations: 'disabled' })

    // Done, it is ready again: its commit is in no pull request, and a new one opens from the task.
    await expect(work.getByText('Ready for a new pull request')).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: 'test-results/rounds-ready-board.png', animations: 'disabled' })
    await work.getByRole('button', { name: 'Add a retry to the checkout call' }).click()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    await expect(page.getByText('One commit after PR #1 isn’t in a pull request yet.')).toBeVisible()
    await page.screenshot({ path: 'test-results/rounds-offer.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Open a new pull request' }).click()

    // The task has both: the new draft, on a branch of its own from main, and the merged one before it.
    await expect(page.getByText('Before this: PR #1, merged on GitHub.')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Mark ready for review' })).toBeVisible()
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/rounds-two-pull-requests.png', animations: 'disabled' })
    expect(execFileSync('git', ['--git-dir', remote, 'rev-list', '--count', `main..${branch}-2`], { encoding: 'utf8' }).trim()).toBe('1')
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(work.getByText('Ready to accept')).toBeVisible()
    await page.screenshot({ path: 'test-results/rounds-two-pull-requests-board.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
