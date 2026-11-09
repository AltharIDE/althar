import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, launch, openFirstProject, planTask, projectSettings, shown, still } from './support'

/*
 * A task that works Local, in the person's own checkout (ADR-091), in a real
 * window with the fake agent: the project starts tasks Local; a plan says so;
 * started with the person's edit not committed there, it asks first, waits as
 * answered and takes the checkout once it is committed; a second task waits
 * for it Up next; abandoned, the checkout goes back to main and the next one
 * takes it, and goes back again once that one is abandoned too. Each part is
 * shot light and dark: test-results/local-*.png.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** The innermost block holding all of `parts`: a card, found by what it shows. */
const blockWith = (page: Page, ...parts: Array<Locator>) =>
  parts.reduce((block, part) => block.filter({ has: part }), page.locator('div').filter({ visible: true })).last()

/** One part of the window at 1×, light and then dark. */
const shoot = async (page: Page, part: Locator, name: string) => {
  await part.scrollIntoViewIfNeeded()
  await still(page)
  await part.screenshot({ path: `test-results/local-${name}-light.png`, scale: 'css', animations: 'disabled' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await still(page)
  await part.screenshot({ path: `test-results/local-${name}-dark.png`, scale: 'css', animations: 'disabled' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark')
}

/** Abandons the task open in the window, from its menu. */
const abandon = async (page: Page) => {
  await page.getByRole('button', { name: 'More for this task' }).click()
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /Abandon/ })
    .click()
  await page.getByRole('dialog', { name: 'Abandon this task?' }).getByRole('button', { name: 'Abandon task' }).click()
}

test('works Local: asks before it takes the checkout, waits for it, and gives it back', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const root = repository(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, root)

    // The project starts new tasks Local.
    await projectSettings(page, 'Tasks')
    const startIn = page.getByRole('main').getByRole('radiogroup', { name: 'New tasks start in' })
    await startIn.getByRole('radio', { name: 'Local' }).click()
    await expect(startIn.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'true')
    await shoot(page, blockWith(page, startIn, page.getByText(/^Local works in your own checkout/)), 'settings')
    await backToWork(page)

    // Planned, it works Local, as the project starts tasks; the person's own edit isn't committed there.
    writeFileSync(join(root, 'NOTES.md'), 'Mine, not committed\n')
    await planTask(page, 'Fix the login', '[lead:wait]')
    const worksIn = page.getByRole('radiogroup', { name: 'Works in' }).last()
    await expect(worksIn.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'true')
    await shoot(page, blockWith(page, worksIn, page.getByRole('button', { name: 'Start now' })), 'plan')
    await page.getByRole('button', { name: 'Start now' }).last().click()

    // It asks before it takes the checkout, in its thread; nothing switches under the edit.
    await page
      .getByRole('button', { name: /Open task/ })
      .last()
      .click()
    const wait = page.getByRole('button', { name: 'Wait until they’re committed' })
    await expect(wait).toBeVisible()
    await shoot(page, blockWith(page, page.getByText('Before it starts'), wait), 'ask')
    expect(git(root, 'branch', '--show-current')).toBe('main')
    await wait.click()
    await expect(shown(page, 'Waits for Local')).toBeVisible()
    await shoot(page, page.getByRole('banner').last(), 'header-waits')

    // Committed: it takes the checkout, on a branch of its own, says so, and its composer says Local.
    git(root, 'add', 'NOTES.md')
    git(root, 'commit', '-q', '-m', 'My notes')
    const checkedOut = shown(page, /^meridian: checked out /)
    await expect(checkedOut).toBeVisible()
    const branch = git(root, 'branch', '--show-current')
    expect(branch).not.toBe('main')
    await shoot(page, blockWith(page, checkedOut), 'checked-out')
    const local = page.getByText('Local', { exact: true }).filter({ visible: true }).last()
    await expect(local).toBeVisible()
    await shoot(page, blockWith(page, page.getByRole('textbox').filter({ visible: true }).last(), local), 'composer')

    // A second task waits for the checkout: its plan says for which, and Up next on the board.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await backToWork(page)
    await planTask(page, 'Dark mode for Settings', '[lead:finish]')
    const taken = page.getByText('Waits for Fix the login.').filter({ visible: true }).last()
    await expect(taken).toBeVisible()
    await shoot(page, blockWith(page, page.getByRole('radiogroup', { name: 'Works in' }), taken), 'plan-taken')
    await page.getByRole('button', { name: 'Start now' }).last().click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const next = work.getByRole('region', { name: 'Up next' })
    await expect(next.getByText('After Fix the login')).toBeVisible()
    await expect(next.getByText('Waits for Local', { exact: true })).toBeVisible()
    await expect(next.getByText('Paused', { exact: true })).toHaveCount(0)
    await expect(work.getByText('Change · Local')).toHaveCount(2)
    await shoot(page, work, 'board')

    // The first abandoned: the checkout goes back to main, and the second takes it.
    await work.getByText('Fix the login', { exact: true }).click()
    await abandon(page)
    await expect(shown(page, 'meridian is back on main')).toBeVisible()
    await shoot(page, blockWith(page, page.getByText('meridian is back on main')), 'back')
    await expect.poll(() => git(root, 'branch', '--show-current')).not.toBe(branch)
    await expect.poll(() => git(root, 'branch', '--show-current')).not.toBe('main')

    // The second abandoned too: back on main, with the person's commit, and nothing of theirs stashed.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    await work.getByText('Dark mode for Settings', { exact: true }).click()
    await abandon(page)
    await expect.poll(() => git(root, 'branch', '--show-current')).toBe('main')
    expect(git(root, 'log', '-1', '--format=%s')).toBe('My notes')
    expect(git(root, 'stash', 'list')).toBe('')
    expect(git(root, 'status', '--porcelain')).toBe('')
  } finally {
    await electronApp.close()
  }
})
