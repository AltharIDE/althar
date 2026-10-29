import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, shown, startTask } from './support'

/*
 * A task's outputs in a real window, with the fake agent and the fake GitHub,
 * at a wide window and a narrow one: a stopped task whose branch has no pull
 * request, as a nightly dependency check leaves it, which says Stopped, names
 * its branch and what of it isn't pushed, lists its files, and opens its
 * draft pull request; and a pull request, open and then merged. The
 * screenshots are this change's own evidence (test-results/outputs/ at the
 * repository's root, which a run here doesn't clear).
 */

const SHOTS = join('..', '..', 'test-results', 'outputs')
const WIDE = 1500
const NARROW = 820

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...author } }).trim()

const write = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

/** A manifest of `n` dependencies, at a version of their own. */
const manifest = (n: number, version: (i: number) => string) =>
  `{\n${Array.from({ length: n }, (_, i) => `  "dependency-${i}": "^${version(i)}",`).join('\n')}\n}\n`

/** What a nightly dependency check touches: the lockfile, and every workspace's manifest. */
const MANIFESTS = [
  'package.json',
  'apps/cli/package.json',
  'apps/desktop/package.json',
  'apps/report/package.json',
  'apps/site/package.json',
  'brand/package.json',
  'packages/connectors/package.json',
  'packages/contracts/package.json',
  'packages/provider-adapters/package.json',
  'packages/runtime/package.json',
  'packages/ui/package.json',
]

/** The task's worktree, by the branch Althar made for it. */
const worktreeOf = (repo: string, branch: RegExp) => {
  const block = git(repo, 'worktree', 'list', '--porcelain')
    .split('\n\n')
    .find((one) => branch.test(one))
  const path = block?.split('\n')[0]?.slice('worktree '.length)
  const name = block
    ?.split('\n')
    .find((line) => line.startsWith('branch '))
    ?.slice('branch refs/heads/'.length)
  if (path === undefined || name === undefined) throw new Error(`No worktree on ${String(branch)}`)
  return { path, branch: name }
}

const shoot = async (electronApp: ElectronApplication, page: Page, name: string) => {
  const prefix = process.env.ALTHAR_SHOTS ?? 'after'
  for (const [width, size] of [
    [WIDE, 'wide'],
    [NARROW, 'narrow'],
  ] as const) {
    await (await electronApp.browserWindow(page)).evaluate((window, x) => window.setSize(x, 900), width)
    await page.mouse.move(width - 10, 890)
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(SHOTS, `${prefix}-${name}-${size}.png`), scale: 'css', animations: 'disabled' })
  }
  await (await electronApp.browserWindow(page)).evaluate((window, x) => window.setSize(x, 900), WIDE)
}

const toOutputs = (page: Page) =>
  page
    .getByRole('radiogroup', { name: 'Face' })
    .getByRole('radio', { name: /Outputs/ })
    .click()

test('a stopped branch with no pull request opens its draft one; a pull request open, and merged; wide and narrow', async () => {
  test.setTimeout(240_000)
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  // What the check updates, as main has it.
  for (const path of MANIFESTS)
    write(
      repo,
      path,
      manifest(24, (i) => `1.${i}.0`),
    )
  write(
    repo,
    'bun.lock',
    manifest(160, (i) => `3.${i}.1`),
  )
  write(repo, '.github/workflows/ci.yml', `on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun install\n`)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Workspaces')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  git(repo, 'remote', 'add', 'origin', 'https://github.test/meridian/api.git')
  git(repo, 'push', '-q', remote, 'main')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  try {
    await (await electronApp.browserWindow(page)).evaluate((window, x) => window.setSize(x, 900), WIDE)
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    // The check's lead works until it is stopped; meanwhile it commits the update, which reaches GitHub, then brings main in after.
    await startTask(page, 'Nightly dependency check, 27 Oct', '[lead:wait]')
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByText('Implementing', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    const nightly = worktreeOf(repo, /branch refs\/heads\/althar\/nightly/)
    for (const [n, path] of MANIFESTS.entries())
      write(
        nightly.path,
        path,
        manifest(24, (i) => (i % 3 === n % 3 ? `2.${i}.0` : `1.${i}.0`)),
      )
    write(
      nightly.path,
      'bun.lock',
      manifest(150, (i) => (i % 2 === 0 ? `3.${i}.4` : `3.${i}.1`)),
    )
    write(nightly.path, 'patches/claude-agent-acp.patch', '--- a/dist/index.js\n+++ b/dist/index.js\n@@ -1 +1 @@\n-old\n+new\n')
    git(nightly.path, 'add', '.')
    git(nightly.path, 'commit', '-q', '-m', 'Update dependencies')
    git(nightly.path, 'push', '-q', remote, `HEAD:refs/heads/${nightly.branch}`)
    write(
      nightly.path,
      '.github/workflows/ci.yml',
      `on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun install --frozen-lockfile\n`,
    )
    git(nightly.path, 'commit', '-q', '-am', 'Install from the lockfile as it is')
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: /Stop the task/ }).click()
    await expect(shown(page, 'Stopped', { exact: true })).toBeVisible({ timeout: 15_000 })
    await toOutputs(page)
    // GitHub has the first commit, but nothing here says so: both are counted, rather than the branch called missing.
    const branch = page.getByRole('article', { name: 'Nightly dependency check, 27 Oct' })
    await expect(branch.getByText(nightly.branch, { exact: true })).toBeVisible()
    await expect(branch.getByText('2 commits not pushed')).toBeVisible()
    await expect(branch.getByRole('button', { name: 'Open the diff of apps/cli/package.json' })).toBeVisible()
    await shoot(electronApp, page, 'branch')

    // A pull request: opened as the lead finishes, then four more files the lead committed, pushed.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await startTask(page, 'Rate-limit refunds per partner', '[lead:finish] [lead:edit]')
    await expect(page.getByText('PR #1')).toBeVisible({ timeout: 30_000 })
    const refunds = worktreeOf(repo, /branch refs\/heads\/althar\/rate-limit/)
    write(refunds.path, 'src/refunds/create.ts', 'export const create = () => limit()\n')
    write(refunds.path, 'src/refunds/limits.ts', 'export const limit = () => 10\nexport const window = 60\n')
    write(refunds.path, 'src/refunds/partners.ts', 'export const partners = new Map<string, number>()\n')
    write(
      refunds.path,
      'test/refunds/limits.test.ts',
      "import { limit } from '../../src/refunds/limits'\n\ntest('limits', () => expect(limit()).toBe(10))\n",
    )
    git(refunds.path, 'add', '.')
    git(refunds.path, 'commit', '-q', '-m', 'Limit refunds per partner')
    // The newest task's card is the last in the conversation.
    await page
      .getByRole('button', { name: /Open task/ })
      .last()
      .click()
    await toOutputs(page)
    await page.getByRole('button', { name: 'Push 1 commit' }).click()
    await expect(page.getByRole('button', { name: 'Push 1 commit' })).toHaveCount(0, { timeout: 15_000 })
    await shoot(electronApp, page, 'pull-request')

    // Accepted: GitHub merges it.
    await page.getByRole('button', { name: 'Mark ready for review' }).click()
    await page.getByRole('button', { name: 'Accept and merge' }).click()
    await expect(shown(page, 'Merged', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await shoot(electronApp, page, 'merged')

    // Stopped, the check's branch still opens its draft pull request: pushed as it opens.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page
      .getByRole('button', { name: /Open task/ })
      .first()
      .click()
    await toOutputs(page)
    await branch.getByRole('button', { name: 'Open a draft pull request' }).click()
    const opened = page.getByRole('article', { name: 'Nightly dependency check, 27 Oct' })
    await expect(opened.getByText('PR #2')).toBeVisible({ timeout: 20_000 })
    await expect(opened.getByText('Draft', { exact: true })).toBeVisible()
    expect(git(remote, 'rev-parse', nightly.branch)).toBe(git(nightly.path, 'rev-parse', 'HEAD'))
  } finally {
    await electronApp.close()
  }
})
