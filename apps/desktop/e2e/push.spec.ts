import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject } from './support'

/*
 * Pushing what the lead committed after its pull request opened, in a real
 * window with the fake agent and the fake GitHub (ADR-022): the card counts
 * the commits, one press sends them all, and the count is gone as the press
 * ends, with no second press.
 */

test('pushes ten commits in one press, and counts none left as it ends', async () => {
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

    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue)/ })
    await box.fill('Rate-limit refunds per partner. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
    await box.press('Enter')
    await page.getByRole('button', { name: 'Start now' }).click({ timeout: 20_000 })
    await expect(page.getByText('PR #1')).toBeVisible({ timeout: 30_000 })

    // The lead commits ten more in the task's worktree, as Claude Code does, with its own credit line.
    const worktree = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo })
      .toString()
      .split('\n\n')
      .find((block) => block.includes('branch refs/heads/althar/'))
      ?.split('\n')[0]
      ?.slice('worktree '.length)
    expect(worktree).toBeDefined()
    for (let n = 1; n <= 10; n++)
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', `Step ${n}`, '-m', 'Co-Authored-By: Claude <noreply@anthropic.com>'], {
        cwd: worktree,
        env: { ...process.env, ...author },
      })

    await page.getByRole('button', { name: /Open task/ }).click()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    const push = page.getByRole('button', { name: 'Push 10 commits' })
    await expect(push).toBeVisible({ timeout: 15_000 })
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/push-before.png', animations: 'disabled' })

    await push.click()
    // As the press ends, nothing is left: no count, and no Push to press again.
    await expect(push).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Push \d+ commits?$/ })).toHaveCount(0)
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree }).toString().trim()).toBe(
      execFileSync(
        'git',
        ['rev-parse', `refs/heads/${execFileSync('git', ['branch', '--show-current'], { cwd: worktree }).toString().trim()}`],
        {
          cwd: remote,
        },
      )
        .toString()
        .trim(),
    )
    await page.screenshot({ path: 'test-results/push-after.png', animations: 'disabled' })

    // The host's next looks leave it so.
    await page.waitForTimeout(4_000)
    await expect(page.getByRole('button', { name: /^Push \d+ commits?$/ })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/push-after-looks.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
