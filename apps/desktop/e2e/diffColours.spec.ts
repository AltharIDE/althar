import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, startTask, still } from './support'

/*
 * A task's change in its Outputs, in the file's colours: a TypeScript file
 * whose change sits inside a block comment and a template string, and a
 * stylesheet. The screenshots, light and dark, are the change's evidence
 * (test-results/diff-colours/ at the repository's root; ALTHAR_SHOTS names
 * them, `after` unless set).
 */

const SHOTS = join('..', '..', 'test-results', 'diff-colours')

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...author } }).trim()

const write = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const LIMITS = (body: string, said: string) => `import type { Merchant } from './merchants'

export interface Limit {
  readonly perWindow: number
  readonly windowSeconds: number
}

/*
 * How many refunds a merchant may ask for in a window.
${body}
 */
export const limitOf = (merchant: Merchant): Limit =>
  merchant.partner?.limit ?? { perWindow: 20, windowSeconds: 86_400 }

export const said = (limit: Limit) => \`
  At most \${limit.perWindow} refunds${said}
  \${limit.windowSeconds / 3600} hours.
\`
`

test('a task’s change shows in its file’s colours, light and dark', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  write(repo, 'src/refunds/limits.ts', LIMITS(' * Twenty a day, for everyone.', ''))
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Limits')
  const { electronApp, page } = await launch(home)
  try {
    await sizeWindow(electronApp, page, 1300, 900)
    await openFirstProject(electronApp, page, repo)
    await startTask(page, 'Rate-limit refunds per partner', '[lead:finish]')
    const worktree = git(repo, 'worktree', 'list', '--porcelain')
      .split('\n\n')
      .find((one) => /branch refs\/heads\/althar\/rate-limit/.test(one))
      ?.split('\n')[0]
      ?.slice('worktree '.length)
    if (worktree === undefined) throw new Error('No worktree for the task')
    write(
      worktree,
      'src/refunds/limits.ts',
      LIMITS(" * A partner's own limit where it has one,\n * and twenty a day for the rest.", ' every'),
    )
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-q', '-m', 'Limit refunds per partner')
    await page
      .getByRole('button', { name: /Open task/ })
      .last()
      .click()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    await page.getByRole('button', { name: 'Open the diff of src/refunds/limits.ts' }).click()
    const diff = page.locator('[data-diff]')
    await expect(diff).toBeVisible()
    if ((process.env.ALTHAR_SHOTS ?? 'after') === 'after') await expect(diff.locator('span[style]').first()).toBeVisible()
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
      await still(page)
      await page.screenshot({
        path: join(SHOTS, `${process.env.ALTHAR_SHOTS ?? 'after'}-outputs-${scheme}.png`),
        scale: 'css',
        animations: 'disabled',
      })
    }
  } finally {
    await electronApp.close()
  }
})
