import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, projectSettings, still } from './support'

/*
 * A repository cloned into a project that has one already, from its
 * Repositories settings: GitHub connected in place, in the panel, where its
 * repositories would be; one chosen and cloned where the person keeps code;
 * and it joins the project, its work going to GitHub, connected. Shot at 1×
 * into test-results/clone-into-*.png.
 */

const git = (cwd: string, ...args: ReadonlyArray<string>) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

test('clones a repository from GitHub into a project that has one, GitHub connected in the panel, and it joins the project', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  // GitHub's meridian/api.
  const api = join(home, 'remotes', 'api.git')
  git(home, 'clone', '--quiet', '--bare', meridian, api)
  // Where the person keeps code, where a clone goes unasked.
  mkdirSync(join(home, 'code'))
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE_API: api })
  try {
    await openFirstProject(electronApp, page, meridian)
    await projectSettings(page, 'Code and issues')
    const section = page.getByRole('region', { name: 'Repositories' })
    await section.getByRole('button', { name: 'Clone a repository' }).click()
    const panel = page.getByRole('region', { name: 'Clone a repository' })

    // GitHub connected in place, in the panel; then its repositories are there.
    await panel.getByRole('button', { name: 'Connect GitHub' }).click()
    await panel
      .getByRole('group', { name: 'Ways to connect GitHub' })
      .getByRole('button', { name: /Make a token/ })
      .click()
    await panel.getByRole('button', { name: 'Paste it myself' }).click()
    await panel.getByLabel('Paste it').fill('github_pat_e2e')
    await panel.getByRole('button', { name: 'Check' }).click()
    await expect(panel.getByRole('heading', { name: 'Connected as you' })).toBeVisible()
    await panel.getByRole('button', { name: 'Done', exact: true }).click()

    await panel.getByRole('button', { name: 'Clone meridian/api' }).click()
    await expect(panel.getByText('Into ~/code')).toBeVisible()
    await still(page)
    await section.screenshot({ path: 'test-results/clone-into-01-chosen.png', scale: 'css' })
    await panel.getByRole('button', { name: 'Clone', exact: true }).click()
    await expect(panel).toHaveCount(0)

    // Cloned where the person keeps code, and joined: on this Mac beside meridian.
    const here = section.getByRole('list', { name: /^On / })
    await expect(here.getByRole('button', { name: 'More for api' })).toBeVisible({ timeout: 30_000 })
    await expect(here.getByText(/\/code\/api/)).toBeVisible()
    expect(existsSync(join(home, 'code', 'api', 'README.md'))).toBe(true)
    expect(git(join(home, 'code', 'api'), 'remote', 'get-url', 'origin')).toBe(api)
    await still(page)
    await section.screenshot({ path: 'test-results/clone-into-02-joined.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
