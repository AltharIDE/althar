import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, showPanes } from './support'

/*
 * An optional check's failure holds nothing back (#1117), in a real window with the fake agent and the fake GitHub
 * (ADR-022): main requires `test`, which passes; Cloudflare's preview build, which it doesn't require, fails. The task's
 * card reads Ready to accept, with no red, and says the optional failure quietly. The screenshot is this change's evidence
 * (test-results/optional-checks-card.png).
 */

test('a pull request whose only failure is an optional check reads as ready to accept, its failure a quiet note', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, {
    ALTHAR_FAKE_REMOTE: remote,
    ALTHAR_FAKE_CHECKS: JSON.stringify([
      { name: 'test', state: 'passed' },
      { name: 'Workers Builds: althar-site', state: 'failed' },
    ]),
    ALTHAR_FAKE_RULES: JSON.stringify({ requiredChecks: ['test'], needs: [] }),
  })
  const title = 'Althar stays light on memory with nothing running'
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    await say(page, `${title}. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]`)
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()

    await showPanes(page, { conversation: false, board: true })
    const card = page.getByRole('article').filter({ hasText: title })
    await expect(card.getByText('Optional Workers Builds: althar-site failed')).toBeVisible()
    await expect(card.getByText('Ready to accept')).toBeVisible()
    await expect(card.getByText('Not ready to accept')).toHaveCount(0)
    await expect(card.getByText('1 required check passed')).toBeVisible()
    await page.mouse.move(1400, 300)
    await card.screenshot({ path: 'test-results/optional-checks-card.png', animations: 'disabled', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
