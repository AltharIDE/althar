import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import {
  backToWork,
  chooseFolder,
  launch,
  openFirstProject,
  openMadeProject,
  projectSettings,
  startTask,
  still,
  toFirstProject,
} from './support'

/*
 * A project set up where it starts, on the New project page: its code from
 * a folder that isn't a repository yet (empty, or with files), which gets
 * git on main and a first commit as the project is made; a folder that is a
 * project already, which opens that project instead; a repository cloned
 * from GitHub, and several at once; and a folder put on GitHub as it is
 * made, under the account, pushed and followed. Each state is shot at 1×,
 * light and dark, into test-results/setup-*.png.
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

    // Its settings say its code stays here, and offer to put it on a host, from where it says so.
    await projectSettings(page, 'Code and issues')
    await page.getByRole('button', { name: 'Push to…' }).click()
    await expect(page.getByRole('menuitem', { name: 'Connect GitHub…' })).toBeVisible()
    await shoot(page, '04b-settings-push-to')
    await page.keyboard.press('Escape')
    await backToWork(page)

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

test('clones several repositories from GitHub at once into one project, and says its token reaches only some', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  // GitHub's meridian/api and meridian/web.
  const api = join(home, 'remotes', 'api.git')
  git(home, 'clone', '--quiet', '--bare', meridian, api)
  const web = join(home, 'remotes', 'web.git')
  git(home, 'clone', '--quiet', '--bare', meridian, web)
  const { electronApp, page } = await launch(home, {
    ALTHAR_FAKE_REMOTE_API: api,
    ALTHAR_FAKE_REMOTE_WEB: web,
    ALTHAR_FAKE_LIMITED: '1',
  })
  try {
    await openFirstProject(electronApp, page, meridian)
    await newProject(page, 'Meridian')
    await page.getByRole('button', { name: 'Connect GitHub' }).click()
    await page
      .getByRole('group', { name: 'Ways to connect GitHub' })
      .getByRole('button', { name: /Make a token/ })
      .click()
    await page.getByRole('button', { name: 'Paste it myself' }).click()
    await page.getByLabel('Paste it').fill('github_pat_e2e')
    await page.getByRole('button', { name: 'Check' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Clone meridian/api' }).click()
    await page.getByRole('button', { name: 'Clone meridian/web' }).click()
    await shoot(page, '13-clone-several-chosen')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shoot(page, '13-clone-several-chosen-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.getByRole('button', { name: 'Chosen meridian/api' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Chosen meridian/web' })).toBeVisible()
    await expect(page.getByText('Create clones meridian/api and meridian/web.')).toBeVisible()
    await expect(page.getByText('Only the repositories your GitHub token was given are listed.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Give it more' })).toBeVisible()
    await page.getByRole('button', { name: /^Create Meridian/ }).click()
    await expect(page.getByRole('heading', { name: 'Meridian', level: 1 })).toBeVisible()
    expect(git(join(home, 'code', 'api'), 'remote', 'get-url', 'origin')).toBe(api)
    expect(git(join(home, 'code', 'web'), 'remote', 'get-url', 'origin')).toBe(web)
    await shoot(page, '14-clone-several-made')
  } finally {
    await electronApp.close()
  }
})

test('a task finished in a project only on this computer merges here, or puts the project on GitHub from its card', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  // The empty repository the project goes to on GitHub: at its address there, which git pushes to a bare repository of the
  // test's, as the person's git would to GitHub; its address stays GitHub's, as the project's remote.
  const remote = join(home, 'remotes', 'meridian.git')
  git(home, 'init', '--quiet', '--bare', remote)
  const address = 'https://github.test/you/meridian.git'
  writeFileSync(join(home, '.gitconfig'), `[url "${remote}"]\n\tpushInsteadOf = ${address}\n`, { flag: 'a' })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE_MERIDIAN: address })
  try {
    await openFirstProject(electronApp, page, meridian)
    // GitHub connected in place, from a new project's Clone, then that tab closed: nothing made.
    await newProject(page, 'Scratch')
    await page.getByRole('button', { name: 'Connect GitHub' }).click()
    await page
      .getByRole('group', { name: 'Ways to connect GitHub' })
      .getByRole('button', { name: /Make a token/ })
      .click()
    await page.getByRole('button', { name: 'Paste it myself' }).click()
    await page.getByLabel('Paste it').fill('github_pat_e2e')
    await page.getByRole('button', { name: 'Check' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    // The walk ended, focus is back on the way chosen: the page still has the keyboard, and Escape closes it.
    await expect(way(page, /^Clone/)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    await startTask(page, 'Add a station picker', '[lead:edit] [lead:finish]')
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByText('The task ends on its branch.')).toBeVisible()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    const card = page.getByRole('article', { name: 'Add a station picker' })
    // Nothing says it lacks a host: merging here is the way, and putting it on a host the quiet one beside it.
    await expect(card.getByRole('button', { name: /^Merge into main on this/ })).toBeVisible()
    await expect(card.getByText(/No code host/)).toHaveCount(0)
    const putOn = card.getByRole('button', { name: 'Push to…' })
    await expect(putOn).toBeVisible()
    await card.screenshot({ path: 'test-results/setup-10-task-only-here.png', scale: 'css' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await still(page)
    await card.screenshot({ path: 'test-results/setup-10-task-only-here-dark.png', scale: 'css' })
    await page.emulateMedia({ colorScheme: 'light' })

    // On GitHub from the card: made there, main pushed, and the card opens its pull request there from then.
    await putOn.click()
    await page.getByRole('menuitem', { name: 'A new repository on GitHub' }).click()
    const form = page.getByRole('heading', { name: 'A new repository on GitHub' })
    await expect(form).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/setup-11-task-put-on-github.png', scale: 'css' })
    await page.getByRole('button', { name: 'Create and push' }).click()
    await expect(page.getByRole('button', { name: 'Open a draft pull request' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Push to…' })).toHaveCount(0)
    expect(git(remote, 'rev-parse', 'main')).toBe(git(meridian, 'rev-parse', 'main'))
    expect(git(meridian, 'config', 'remote.origin.url')).toBe(address)
    await still(page)
    await page.screenshot({ path: 'test-results/setup-12-task-on-github.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})

test('the first run takes a folder with no git yet, among three ways in, and makes it a repository as the project is made', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const notes = join(home, 'Documents', 'notes')
  mkdirSync(notes, { recursive: true })
  writeFileSync(join(notes, 'ideas.md'), '# Ideas\n')
  const { electronApp, page } = await launch(home)
  try {
    await toFirstProject(page)
    await expect(way(page, /^A folder/)).toHaveAttribute('aria-checked', 'true')
    await expect(way(page, /^Clone/)).toBeVisible()
    await expect(way(page, /^Start empty/)).toBeVisible()
    await chooseFolder(electronApp, notes)
    await page.getByRole('button', { name: /Choose a folder/ }).click()
    await expect(page.getByText('no git yet, git starts in it')).toBeVisible()
    await shoot(page, '13-first-run-folder-no-git')
    await page.getByRole('button', { name: /^Make the project/ }).click()
    await openMadeProject(page)
    await expect(page.getByRole('heading', { name: 'notes', level: 1 })).toBeVisible()
    expect(git(notes, 'branch', '--show-current')).toBe('main')
    expect(git(notes, 'ls-files').split('\n').toSorted()).toEqual(['.gitignore', 'ideas.md'])
  } finally {
    await electronApp.close()
  }
})

test('the first run starts empty: named first, placed, and made a repository with a first commit as the project is made', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const code = join(home, 'code')
  mkdirSync(code, { recursive: true })
  const { electronApp, page } = await launch(home)
  try {
    await toFirstProject(page)
    // Chosen by the keyboard, as a radio group is: focus shows on the way, uncut.
    await way(page, /^A folder/).focus()
    await page.keyboard.press('ArrowRight')
    await expect(way(page, /^Start empty/)).toHaveAttribute('aria-checked', 'true')
    await expect(way(page, /^Start empty/)).toBeFocused()
    await expect(page.getByRole('button', { name: 'Name it first' })).toBeDisabled()
    await shoot(page, '14-first-run-start-empty')
    await page.getByLabel('Project name').fill('Lighthouse')
    await chooseFolder(electronApp, code)
    await page.getByRole('button', { name: 'Choose where it goes…' }).click()
    await expect(page.getByText('A new repository, on main')).toBeVisible()
    await shoot(page, '15-first-run-start-empty-placed')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shoot(page, '15-first-run-start-empty-placed-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: /^Make the project/ }).click()
    await openMadeProject(page)
    await expect(page.getByRole('heading', { name: 'Lighthouse', level: 1 })).toBeVisible()
    const made = join(code, 'lighthouse')
    expect(git(made, 'branch', '--show-current')).toBe('main')
    expect(git(made, 'rev-list', '--count', 'HEAD')).toBe('1')
  } finally {
    await electronApp.close()
  }
})

test('the first run clones an empty repository from GitHub, gives it a first commit, skips the code step, and a task starts in it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  // GitHub's meridian/api, with nothing pushed to it yet.
  const api = join(home, 'remotes', 'api.git')
  mkdirSync(api, { recursive: true })
  git(api, 'init', '--quiet', '--bare', '--initial-branch=main')
  // Where the person keeps code, where a clone goes unasked.
  mkdirSync(join(home, 'code'))
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE_API: api })
  try {
    await toFirstProject(page)
    await way(page, /^Clone/).click()
    await page.getByRole('button', { name: 'Connect GitHub' }).click()
    await page
      .getByRole('group', { name: 'Ways to connect GitHub' })
      .getByRole('button', { name: /Make a token/ })
      .click()
    await page.getByRole('button', { name: 'Paste it myself' }).click()
    await page.getByLabel('Paste it').fill('github_pat_e2e')
    await page.getByRole('button', { name: 'Check' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Clone meridian/api' }).click()
    await expect(page.getByRole('button', { name: 'Chosen meridian/api' })).toBeVisible()
    await expect(page.getByText('Into ~/code')).toBeVisible()
    await shoot(page, '16-first-run-clone-chosen')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shoot(page, '16-first-run-clone-chosen-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: /^Make the project/ }).click()
    // Its code lives where it came from: no step to put it on a host.
    await expect(page.getByRole('heading', { name: /code/i, level: 1 })).toHaveCount(0)
    await openMadeProject(page)
    await expect(page.getByRole('heading', { name: 'Api', level: 1 })).toBeVisible()
    const cloned = join(home, 'code', 'api')
    expect(git(cloned, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(git(cloned, 'remote', 'get-url', 'origin')).toBe(api)
    // A task branches from it: its worktree is made.
    await startTask(page, 'Write the README')
    await expect.poll(() => git(cloned, 'worktree', 'list').split('\n').length).toBeGreaterThan(1)
  } finally {
    await electronApp.close()
  }
})
