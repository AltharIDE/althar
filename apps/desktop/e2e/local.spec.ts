import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, launch, openFirstProject, planTask, projectSettings, shown, still, showPanes } from './support'

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

const planOf = (page: Page, title: string) =>
  page.locator('[data-rhythm="card"]').filter({ has: page.getByText(title, { exact: true }), visible: true })

/** Photograph a complete plan held still: its real countdown can otherwise start it between the light and dark shots. */
const holdForShot = async (plan: Locator) => {
  await expect(plan.getByRole('button', { name: 'Start now', exact: true })).toBeVisible()
  await plan.getByRole('button', { name: 'Hold', exact: true }).click()
  const start = plan.getByRole('button', { name: 'Start', exact: true })
  await expect(start).toBeVisible()
  return start
}

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

/**
 * What the task's page and the checkout showed, first in a failure's message: a quarantined failure keeps no trace, only
 * the start of what it says (#569). Its header, the end of its thread, and the checkout's branch and what isn't committed.
 */
const whatItSaw = async (page: Page, root: string) => {
  const words = async (part: Locator, last: number) => {
    // Only what is there now: waiting for a part that never came would spend the failure's own time.
    const text = (await part.count()) === 0 ? '' : await part.innerText().catch(() => '')
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat === '' ? '(nothing)' : flat.length > last ? `…${flat.slice(-last)}` : flat
  }
  const header = await words(page.getByRole('banner').filter({ visible: true }).last(), 200)
  const thread = await words(page.getByRole('region', { name: 'Thread' }).filter({ visible: true }).last(), 500)
  // A git that can't read it says why, rather than losing what the window showed and the failure itself.
  const checkout = (() => {
    try {
      return `${git(root, 'branch', '--show-current')}, ${git(root, 'status', '--porcelain') || 'all committed'}`
    } catch (error) {
      return `unread: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    }
  })()
  return `It saw: header: ${header} | thread: ${thread} | checkout: ${checkout}`
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
    const login = planOf(page, 'Fix the login')
    const worksIn = login.getByRole('radiogroup', { name: 'Works in' })
    await expect(worksIn.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'true')
    const start = await holdForShot(login)
    await shoot(page, login, 'plan')
    await start.click()

    // It asks before it takes the checkout, in its thread; nothing switches under the edit.
    const work = page.getByRole('region', { name: 'The project’s work' })
    await showPanes(page, { conversation: false, board: true })
    await work.getByRole('button', { name: 'Fix the login', exact: true }).click()
    const wait = page.getByRole('button', { name: 'Wait until they’re committed' })
    // Where it doesn't come, what was there instead (#569): the cause isn't known yet.
    await expect(wait)
      .toBeVisible()
      .catch(async (error: unknown) => {
        throw new Error(`The ask didn't come. ${await whatItSaw(page, root)}\n${error instanceof Error ? error.message : String(error)}`)
      })
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
    const darkMode = planOf(page, 'Dark mode for Settings')
    const taken = darkMode.getByText('Waits for Fix the login.', { exact: true })
    await expect(taken).toBeVisible()
    const startWaiting = await holdForShot(darkMode)
    await shoot(page, darkMode, 'plan-taken')
    await startWaiting.click()
    await showPanes(page, { conversation: false, board: true })
    const next = work.getByRole('region', { name: 'Up next' })
    await expect(next.getByText('After Fix the login')).toBeVisible()
    await expect(next.getByText('Waits for Local', { exact: true })).toBeVisible()
    await expect(next.getByText('Paused', { exact: true })).toHaveCount(0)
    // Change is the usual kind and is no longer repeated on a board row; both tasks still name Local.
    await expect(work.getByText('Local', { exact: true })).toHaveCount(2)
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
    await showPanes(page, { conversation: false, board: true })
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
