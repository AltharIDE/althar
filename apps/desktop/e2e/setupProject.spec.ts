import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, openFirstProject, still } from './support'

/*
 * A project set up where it starts, on the New project page: its code from
 * a folder that isn't a repository yet (empty, or with files), which gets
 * git on main and a first commit as the project is made; a folder that is a
 * project already, which opens that project instead; a repository cloned
 * from GitHub; and a folder put on GitHub as it is made, under the account,
 * pushed and followed. Each state is shot at 1×, light and dark, into
 * test-results/setup-*.png.
 */

const git = (cwd: string, ...args: ReadonlyArray<string>) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** The page, still, at 1×: the window's whole tab. */
const shoot = async (page: Page, name: string) => {
  await still(page)
  await page.screenshot({ path: `test-results/setup-${name}.png`, scale: 'css' })
}

/** Starts a new project, named. */
const newProject = async (page: Page, name: string) => {
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: 'New project' }).click()
  const field = page.getByRole('textbox', { name: 'Name' })
  await expect(field).toBeFocused()
  await field.fill(name)
}

const way = (page: Page, name: RegExp) => page.getByRole('radiogroup', { name: 'Where its code comes from' }).getByRole('radio', { name })

test('sets up a project from folders that aren’t repositories yet, and refuses one that is a project already', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const tidepool = join(home, 'code', 'tidepool')
  mkdirSync(join(tidepool, 'src'), { recursive: true })
  writeFileSync(join(tidepool, 'README.md'), '# Tidepool\n')
  writeFileSync(join(tidepool, 'src', 'main.ts'), 'export {}\n')
  writeFileSync(join(tidepool, '.env'), 'SECRET=1\n')
  const empty = join(home, 'code', 'empty')
  mkdirSync(empty)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // Nothing connected: Clone offers the hosts to connect, in place.
    await newProject(page, 'Tidepool')
    await expect(way(page, /^Clone/)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('button', { name: 'Connect GitHub' })).toBeVisible()
    await shoot(page, '01-clone-nothing-connected')

    // A folder with files and no git: said so, and Create starts git in it.
    await way(page, /^A folder/).click()
    await shoot(page, '02-folder-none-chosen')
    await chooseFolder(electronApp, tidepool)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    await expect(page.getByText('No git yet. It starts on main, with what’s in it as the first commit.')).toBeVisible()
    await expect(page.getByText('Create starts git in it. Its code stays on')).toBeVisible()
    await shoot(page, '03-folder-files-no-git')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shoot(page, '03-folder-files-no-git-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: /^Create Tidepool/ }).click()
    await expect(page.getByRole('heading', { name: 'Tidepool', level: 1 })).toBeVisible()
    expect(git(tidepool, 'branch', '--show-current')).toBe('main')
    expect(git(tidepool, 'log', '--format=%s')).toBe('Initial commit')
    expect(git(tidepool, 'ls-files').split('\n').toSorted()).toEqual(['.gitignore', 'README.md', 'src/main.ts'])
    expect(readFileSync(join(tidepool, '.gitignore'), 'utf8')).toContain('.env')
    await shoot(page, '04-folder-files-made')

    // An empty folder: said so, and made with a first commit.
    await newProject(page, 'Empty')
    await way(page, /^A folder/).click()
    await chooseFolder(electronApp, empty)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    await expect(page.getByText('Empty. Git starts in it on main, with a first commit.')).toBeVisible()
    await page.getByRole('button', { name: /^Create Empty/ }).click()
    await expect(page.getByRole('heading', { name: 'Empty', level: 1 })).toBeVisible()
    expect(git(empty, 'log', '--format=%s')).toBe('Initial commit')

    // A folder that is a project already: said so, with the way to it; Create makes no second project.
    await newProject(page, 'Again')
    await way(page, /^A folder/).click()
    await chooseFolder(electronApp, tidepool)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    await expect(page.getByText('It’s Tidepool already.')).toBeVisible()
    await shoot(page, '05-folder-a-project-already')
    await page.getByRole('button', { name: 'Open Tidepool' }).first().click()
    await expect(page.getByRole('heading', { name: 'Tidepool', level: 1 })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('clones a repository from GitHub, and puts a new one on GitHub as it is made', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  // GitHub's meridian/api, and the empty repository a new one on GitHub is pushed to.
  const api = join(home, 'remotes', 'api.git')
  git(home, 'clone', '--quiet', '--bare', meridian, api)
  const fresh = join(home, 'remotes', 'harbour.git')
  git(home, 'init', '--quiet', '--bare', fresh)
  const harbour = join(home, 'code', 'harbour')
  mkdirSync(harbour, { recursive: true })
  writeFileSync(join(harbour, 'index.html'), '<p>Harbour</p>\n')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE_API: api, ALTHAR_FAKE_REMOTE_HARBOUR: fresh })
  try {
    await openFirstProject(electronApp, page, meridian)

    // GitHub connected in place, from Clone, where its repositories would be; then they're there.
    await newProject(page, 'Api')
    await page.getByRole('button', { name: 'Connect GitHub' }).click()
    await page
      .getByRole('group', { name: 'Ways to connect GitHub' })
      .getByRole('button', { name: /Make a token/ })
      .click()
    await shoot(page, '06-clone-connecting-in-place')
    await page.getByRole('button', { name: 'Paste it myself' }).click()
    await page.getByLabel('Paste it').fill('github_pat_e2e')
    await page.getByRole('button', { name: 'Check' }).click()
    await expect(page.getByRole('heading', { name: 'Connected as you' })).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'Clone meridian/api' })).toBeVisible()
    await shoot(page, '07-clone-listed')
    await page.getByRole('button', { name: 'Clone meridian/api' }).click()
    await expect(page.getByText('On GitHub, at meridian/api. Tasks open pull requests there.')).toBeVisible()
    await shoot(page, '08-clone-chosen')
    // Into where the person keeps code, ~/code here, said under the list, and changed there.
    await expect(page.getByText('Into ~/code')).toBeVisible()
    await page.getByRole('button', { name: /^Create Api/ }).click()
    await expect(page.getByRole('heading', { name: 'Api', level: 1 })).toBeVisible()
    expect(existsSync(join(home, 'code', 'api', 'README.md'))).toBe(true)
    expect(git(join(home, 'code', 'api'), 'remote', 'get-url', 'origin')).toBe(api)

    // A folder put on GitHub as it is made: a new repository there, pushed and followed.
    await newProject(page, 'Harbour')
    await way(page, /^A folder/).click()
    await chooseFolder(electronApp, harbour)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    const code = page.getByRole('radiogroup', { name: 'Where its code lives' })
    await expect(code.getByRole('radio', { name: /A new repository on GitHub/ })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('Create starts git in it and puts it on GitHub.')).toBeVisible()
    await shoot(page, '09-folder-to-github')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shoot(page, '09-folder-to-github-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: /^Create Harbour/ }).click()
    await expect(page.getByRole('heading', { name: 'Harbour', level: 1 })).toBeVisible()
    expect(git(fresh, 'rev-parse', 'main')).toBe(git(harbour, 'rev-parse', 'HEAD'))
    expect(git(harbour, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main')
  } finally {
    await electronApp.close()
  }
})
