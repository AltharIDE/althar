import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say } from './support'

/*
 * Abandoning a task with its pull request open, in a real window with the
 * fake agent and the fake GitHub: the dialog offers to close it on GitHub,
 * on as it opens. Left open, the board says it is still open, as GitHub
 * does, and closes it from its row in one press.
 */

test('offers to close an abandoned task’s pull request, says it is still open where it was left, and closes it from the board', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    await say(page, 'Prototype the settled lane. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
    await page.getByRole('button', { name: 'Start now' }).click({ timeout: 20_000 })
    await expect(page.getByText('PR #1')).toBeVisible({ timeout: 30_000 })

    // The dialog offers to close it on GitHub, on; its branch there to delete, off.
    await page.getByRole('button', { name: /Open task/ }).click()
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /Abandon/ })
      .click()
    const asked = page.getByRole('dialog', { name: 'Abandon this task?' })
    const close = asked.getByRole('checkbox', { name: 'Close pull request #1 on GitHub' })
    await expect(close).toBeChecked()
    await expect(asked.getByRole('checkbox', { name: 'Delete its branch on GitHub' })).not.toBeChecked()
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/abandon-dialog.png', animations: 'disabled' })

    // Left open, as the person's earlier tasks were: GitHub still has it open.
    await close.click()
    await asked.getByRole('button', { name: 'Abandon task' }).click()
    await expect(asked).toHaveCount(0)
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByText('PR #1 still open')).toBeVisible({ timeout: 10_000 })
    await expect(work.getByText('PR #1 closed')).toHaveCount(0)
    const closing = work.getByRole('button', { name: 'Close PR #1' })
    await expect(closing).toBeVisible()
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/abandoned-still-open.png', animations: 'disabled' })

    // One press closes it on GitHub, and the row says so.
    await closing.click()
    await expect(work.getByText('PR #1 closed')).toBeVisible({ timeout: 10_000 })
    await expect(closing).toHaveCount(0)
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/abandoned-closed.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
