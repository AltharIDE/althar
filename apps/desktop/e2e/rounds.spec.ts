import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, toConversation } from './support'

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

test('a merged task goes back to work when the person writes to its lead, and ships it as a second pull request by itself', async () => {
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
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await page.getByRole('button', { name: 'Mark ready for review' }).click()
    await page.getByRole('button', { name: 'Accept and merge' }).click()
    squashMerge(remote, branch)
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByText('PR #1 merged')).toBeVisible()

    // The person goes back to it and asks its lead for more: it runs again, a follow-up, on the board and in the task.
    await work.getByRole('button', { name: 'Add a retry to the checkout call' }).click()
    await toConversation(page)
    await say(page, 'Add the slider we agreed on. [lead:slowly] [lead:finish]')
    await expect(page.getByText('Following up', { exact: true })).toBeVisible()
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/rounds-running-task.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(work.getByText('Follow-up', { exact: true })).toBeVisible()
    await expect(work.getByText('PR #1 merged')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/rounds-running-board.png', animations: 'disabled' })

    // Done, its commit is in no pull request: a new draft opens by itself, as its plan's did, and the card is under way until it
    // has (ADR-034, DEV-173). It is ready to accept, never ready for a pull request the person would only have to open.
    await expect(work.getByText('Ready to accept')).toBeVisible()
    await expect(work.getByText('Ready for a new pull request')).toHaveCount(0)
    await work.getByRole('button', { name: 'Add a retry to the checkout call' }).click()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()

    // The task has both: the new draft, on a branch of its own from main, and the merged one before it.
    await expect(page.getByText('Before this: PR #1, merged on GitHub.')).toBeVisible()
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

/** The worktree Althar made for a repository of a task, by the task's slug and the repository's name: a folder with its `.git`, under the task's folder. */
const worktreeOf = (home: string, task: string, name: string): string => {
  const look = (path: string, depth: number, inTask: boolean): string | undefined => {
    if (depth > 6 || !existsSync(path)) return undefined
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const inside = join(path, entry.name)
      if (inTask && entry.name === name && existsSync(join(inside, '.git')) && statSync(join(inside, '.git')).isFile()) return inside
      const found = look(inside, depth + 1, inTask || entry.name === task)
      if (found !== undefined) return found
    }
    return undefined
  }
  return look(join(home, 'worktrees'), 0, false) ?? ''
}

const commitIn = (path: string, message: string) => {
  appendFileSync(join(path, 'retry.txt'), `${message}\n`)
  git(path, 'add', '-A')
  git(path, 'commit', '-q', '-m', message)
}

test('a task of two repositories: one’s pull request open beside the other’s new one, and a try that opened one and not the other', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const folder = join(home, 'meridian')
  mkdirSync(folder)
  const remotes: Record<string, string> = {}
  for (const name of ['api', 'web']) {
    const repo = repository(folder, name)
    remotes[name] = join(home, `${name}.git`)
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remotes[name] ?? ''])
    execFileSync('git', ['remote', 'add', 'origin', `https://github.test/meridian/${name}.git`], { cwd: repo })
    execFileSync('git', ['push', '-q', remotes[name] ?? '', 'main'], { cwd: repo })
  }
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE_API: remotes.api ?? '', ALTHAR_FAKE_REMOTE_WEB: remotes.web ?? '' })
  const branch = 'althar/share-the-retry'
  const outputs = () =>
    page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
  const work = page.getByRole('region', { name: 'The project’s work' })
  /** Back on the board, then the task again, read afresh: what git now says of its branches. */
  const again = async () => {
    await page.getByRole('button', { name: 'Back to api' }).click()
    await work.getByRole('button', { name: 'Share the retry' }).click()
    await outputs()
  }
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, folder)
    // A project of the two, named for the first.
    await expect(page.getByRole('heading', { name: 'api', level: 1 })).toBeVisible()
    await connectGitHub(page)

    // Its plan changes api alone: api's pull request opens, and web has none. Accepted, it merges, squashed.
    await say(page, 'Share the retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish]')
    await expect(page.getByRole('button', { name: 'Start now' })).toBeVisible()
    await expect.poll(() => worktreeOf(home, 'share-the-retry', 'web')).not.toBe('')
    const api = worktreeOf(home, 'share-the-retry', 'api')
    const web = worktreeOf(home, 'share-the-retry', 'web')
    commitIn(api, 'Retry api')
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await page.getByRole('button', { name: /^Mark (api )?ready for review$/ }).click()
    await page.getByRole('button', { name: /^Accept and merge/ }).click()
    squashMerge(remotes.api ?? '', branch)
    await page.getByRole('button', { name: 'Back to api' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    await expect(work.getByText('PR #1 merged')).toBeVisible()

    // Its lead changes web for the first time: web's first pull request opens from the task.
    commitIn(web, 'Web first')
    await work.getByRole('button', { name: 'Share the retry' }).click()
    await outputs()
    await expect(page.getByText('One commit isn’t in a pull request yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Open a new draft pull request' }).click()
    await expect(page.getByRole('button', { name: 'Mark web ready for review' })).toBeVisible()

    // Then more in api: web's pull request open, to mark ready and accept, beside api's next, to open.
    commitIn(api, 'More for api')
    await again()
    await expect(page.getByText('One commit isn’t in a pull request yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open a new draft pull request' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark web ready for review' })).toBeVisible()
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/rounds-mixed-task.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Back to api' }).click()
    await expect(work.getByText('Ready to accept')).toBeVisible()
    await expect(work.getByText('althar/share-the-retry', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/rounds-mixed-board.png', animations: 'disabled' })

    // web's merges too; each gets more, and web's host refuses the push: api's next opens, web's doesn't, and is still offered.
    await work.getByRole('button', { name: 'Share the retry' }).click()
    await outputs()
    await page.getByRole('button', { name: 'Mark web ready for review' }).click()
    await page.getByRole('button', { name: /^Accept and merge/ }).click()
    squashMerge(remotes.web ?? '', branch)
    await expect(page.getByRole('button', { name: /^Accept and merge/ })).toHaveCount(0)
    commitIn(api, 'Again for api')
    commitIn(web, 'More for web')
    const refuse = join(remotes.web ?? '', 'hooks', 'pre-receive')
    writeFileSync(refuse, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await again()
    await expect(page.getByText('3 commits aren’t in a pull request yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Open a new draft pull request' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark api ready for review' })).toBeEnabled()
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/rounds-partial-try.png', animations: 'disabled' })
    await again()
    await expect(page.getByText('One commit isn’t in a pull request yet.')).toBeVisible()
    await expect(page.getByText('Before this: api PR #1, merged on GitHub.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open a new draft pull request' })).toBeVisible()
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/rounds-partial-task.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Back to api' }).click()
    await expect(work.getByText('Ready to accept')).toBeVisible()
    await expect(work.getByText('althar/share-the-retry-2')).toBeVisible()
    await page.screenshot({ path: 'test-results/rounds-partial-board.png', animations: 'disabled' })

    // Tried again once the host takes it, web's next opens, on the branch made for it the first time.
    rmSync(refuse)
    await work.getByRole('button', { name: 'Share the retry' }).click()
    await outputs()
    await page.getByRole('button', { name: 'Open a new draft pull request' }).click()
    await expect(page.getByRole('button', { name: 'Open a new draft pull request' })).toHaveCount(0)
    expect(
      execFileSync('git', ['--git-dir', remotes.web ?? '', 'log', '-1', '--format=%s', `${branch}-2`], { encoding: 'utf8' }).trim(),
    ).toBe('More for web')
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/rounds-partial-retried-task.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
