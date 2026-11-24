import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, showPanes, toConversation } from './support'

/*
 * A merged task whose lead drafted issues the person never filed or
 * discarded: it settles, out of Needs you, and its drafts wait at the end of
 * the coordinator's conversation, each its card under the task it came from.
 * Discarded there, a draft is gone from there and from the task's own
 * thread. The screenshots it takes are this change's own evidence
 * (test-results/drafts-left-*.png).
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

const draft = (title: string) => `[lead:call draft_issue ${JSON.stringify({ title, body: `${title}, left for later.` })}]`

/** The window in a theme, as Settings › Appearance would have it. */
const theme = async (electronApp: ElectronApplication, page: Page, scheme: 'light' | 'dark') => {
  await electronApp.evaluate(({ nativeTheme }, to) => {
    nativeTheme.themeSource = to
  }, scheme)
  await page.evaluate((to) => {
    document.documentElement.dataset.theme = to
  }, scheme)
}

test('a merged task with unfiled issue drafts settles, and its drafts wait in the coordinator’s conversation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  const branch = 'althar/approval-center-and-action-ledger'
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 800))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    // Its lead drafts two issues as it works, and the person files neither.
    await say(
      page,
      `Approval center and action ledger. [coordinator:plan-no-review] [coordinator:plan] ${draft('Browser end-to-end tests')} ${draft('CI: Postgres is slow on the runner')} [lead:finish] [lead:edit]`,
    )
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await expect(page.getByRole('heading', { name: 'Browser end-to-end tests' })).toBeVisible()

    // Accepted, GitHub merges it, and it settles though its drafts are unfiled.
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    await page.getByRole('button', { name: 'Mark ready for review' }).click()
    await page.getByRole('button', { name: 'Accept and merge' }).click()
    const clone = mkdtempSync(join(tmpdir(), 'althar-e2e-merge-'))
    execFileSync('git', ['clone', '-q', remote, clone])
    git(clone, 'merge', '-q', '--squash', `origin/${branch}`)
    git(clone, 'commit', '-q', '-m', `Merge ${branch}`)
    git(clone, 'push', '-q', 'origin', 'main')
    await page.getByRole('button', { name: 'Back to meridian' }).click()

    // The board: settled, nothing in Needs you.
    await showPanes(page, { conversation: false, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByText('PR #1 merged')).toBeVisible()
    await expect(work.getByText('Issues to file')).toHaveCount(0)
    await page.mouse.move(1270, 300)
    for (const scheme of ['light', 'dark'] as const) {
      await theme(electronApp, page, scheme)
      await page.screenshot({ path: `test-results/drafts-left-board-${scheme}.png`, animations: 'disabled', scale: 'css' })
    }

    // The coordinator's conversation ends with its drafts, each under the task it came from.
    await theme(electronApp, page, 'light')
    await showPanes(page, { conversation: true, board: false })
    const list = page.locator('section', { has: page.getByRole('heading', { name: '2 issue drafts from finished tasks' }) })
    await expect(list).toBeVisible()
    await list.scrollIntoViewIfNeeded()
    for (const scheme of ['light', 'dark'] as const) {
      await theme(electronApp, page, scheme)
      await list.screenshot({ path: `test-results/drafts-left-list-${scheme}.png`, animations: 'disabled', scale: 'css' })
    }

    // Discarded there, it is gone from the list, and from the task's own thread, at once.
    await theme(electronApp, page, 'light')
    const e2e = list.locator('article', { has: page.getByRole('heading', { name: 'Browser end-to-end tests' }) })
    await e2e.getByRole('button', { name: 'Discard' }).click()
    await expect(list.getByRole('heading', { name: '1 issue draft from a finished task' })).toBeVisible()
    await expect(list.getByRole('heading', { name: 'Browser end-to-end tests' })).toHaveCount(0)
    await list.screenshot({ path: 'test-results/drafts-left-list-discarded.png', animations: 'disabled', scale: 'css' })
    await list.getByRole('button', { name: 'Approval center and action ledger' }).click()
    await toConversation(page)
    await expect(page.getByText('Issue draft discarded')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'CI: Postgres is slow on the runner' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
