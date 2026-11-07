import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, still } from './support'

/*
 * While you were away, taken back from the board (ADR-097), in a real window
 * with the fake agent and the fake GitHub: a lead comments on its own pull
 * request, the board lists it over the lanes with Delete, and Delete takes
 * it off GitHub, the row saying so. Shot in light and dark
 * (test-results/away-*.png).
 */

const shoot = async (page: Page, name: string, what: Locator) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    await still(page)
    await what.screenshot({ path: `test-results/away-${name}-${scheme}.png`, scale: 'css', animations: 'disabled' })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test('a lead’s comment on its pull request is on the board, and Delete takes it off GitHub', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 800))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    await say(
      page,
      'Rate-limit refunds per partner. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:comment]',
    )
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()

    // Its lead, asked in its task, comments on its pull request.
    await page.getByRole('button', { name: /Open task/ }).click()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Conversation/ })
      .click()
    await say(page, 'comment pls')
    await expect(page.getByText('Replied on PR #1.')).toBeVisible()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Home' }).click()

    const away = page.getByRole('region', { name: 'While you were away' })
    const row = away.getByRole('listitem').filter({ hasText: 'Commented on #1' })
    await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible()
    await shoot(page, 'comment', away)

    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(row.getByText('Deleted')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0)
    await shoot(page, 'deleted', away)
  } finally {
    await electronApp.close()
  }
})
