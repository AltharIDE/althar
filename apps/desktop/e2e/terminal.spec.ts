import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { budget } from '@althar/testing/budget'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, still } from './support'

/*
 * The status line and its terminals, in the built app with a real shell: a
 * terminal opens at once in the project's repository, takes keys, says what
 * runs in front of its shell, and asks before closing stops it; a run that
 * fails shows along the line, its output a press away with Help me fix it,
 * and goes with its X. Quit asks first while something runs in a terminal,
 * and not for an idle shell.
 */

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 't@althar.test',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 't@althar.test',
}

/** Opens a terminal with Ctrl+`, pressed again until the screen has drawn and listens. */
const openTerminal = async (page: Page) => {
  await expect(async () => {
    if ((await line(page).count()) === 0) await page.keyboard.press('Control+Backquote')
    await expect(line(page).getByRole('button', { name: 'meridian', exact: true })).toBeVisible({ timeout: budget.small })
  }).toPass()
}

const line = (page: Page) => page.getByLabel('Runs and terminals', { exact: true })
const drawer = (page: Page) => page.getByRole('region', { name: 'Runs and terminals drawer' })
/** What the terminal has keys for. */
const terminalKeys = (page: Page) => drawer(page).locator('.xterm-helper-textarea')

test('a terminal opens in the project’s repository, says what runs in it, and asks before closing stops it; a failed run shows along the line', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({
      name: 'meridian',
      private: true,
      scripts: { dev: 'node -e "console.error(\'error: log file changed but frozen\'); process.exit(1)"' },
    }),
  )
  execFileSync('git', ['add', '.'], { cwd: repo, env })
  execFileSync('git', ['commit', '-q', '-m', 'A dev script that fails'], { cwd: repo, env })
  const { electronApp, page } = await launch(home)
  try {
    await sizeWindow(electronApp, page, 1280, 820)
    await openFirstProject(electronApp, page, repo)
    // Nothing runs and no terminal is open: no line.
    await expect(line(page)).toHaveCount(0)

    // Ctrl+`: a terminal at once, in the drawer, with the keys.
    await openTerminal(page)
    await expect(drawer(page)).toBeVisible()
    await expect(terminalKeys(page)).toBeFocused()
    // What is typed reaches a real shell, in the project's repository.
    await page.keyboard.type('echo "typed in Althar" > from-the-terminal.txt\n', { delay: 10 })
    await expect.poll(() => existsSync(join(repo, 'from-the-terminal.txt'))).toBe(true)
    expect(readFileSync(join(repo, 'from-the-terminal.txt'), 'utf8')).toBe('typed in Althar\n')
    await page.keyboard.type('printf "\\033[32mgreen\\033[0m and \\033[1mbold\\033[0m\\n"; ls\n', { delay: 5 })
    await expect(
      drawer(page)
        .getByText(/meridian/)
        .first(),
    ).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/terminal-open.png', scale: 'css' })

    // Something runs in front of the shell: the line says so, and closing it asks first.
    await page.keyboard.type('sleep 60\n')
    const item = line(page).getByRole('listitem').filter({ hasText: 'meridian' })
    await expect(item).toContainText('sleep')
    // Escape is the shell's while the terminal has the keys: the drawer stays.
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeVisible()
    await item.hover()
    await item.getByRole('button', { name: 'Close meridian' }).click()
    const ask = page.getByRole('dialog', { name: 'Close terminal' })
    await expect(ask).toContainText('sleep is still running in it. Closing the terminal stops it.')
    await still(page)
    await page.screenshot({ path: 'test-results/terminal-close-asks.png', scale: 'css' })
    await ask.getByRole('button', { name: 'Keep' }).click()
    await expect(item).toBeVisible()
    await item.hover()
    await item.getByRole('button', { name: 'Close meridian' }).click()
    await page.getByRole('dialog', { name: 'Close terminal' }).getByRole('button', { name: 'Close terminal' }).click()
    await expect(item).toHaveCount(0)

    // A run that fails: on the line as it ended, its output a press away, with Help me fix it and a terminal where it ran.
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByRole('dialog', { name: 'What it runs' }).getByRole('button', { name: 'Run npm run dev' }).click()
    await page.keyboard.press('Escape')
    const run = line(page).getByRole('listitem').filter({ hasText: 'npm run dev' })
    await expect(run).toContainText('Exited 1')
    await run
      .getByRole('button', { name: /npm run dev/ })
      .first()
      .click()
    await expect(drawer(page)).toContainText('error: log file changed but frozen')
    await expect(drawer(page).getByRole('button', { name: 'Help me fix it' })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/terminal-failed-run.png', scale: 'css' })
    // In dark, the same.
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await drawer(page).getByRole('button', { name: 'Open a terminal where it ran' }).click()
    await expect(terminalKeys(page)).toBeFocused()
    // The shell says it has printed by a file it writes after: the terminal draws on a canvas, with no text to look for.
    const printed = join(home, 'dark-printed')
    await page.keyboard.type(`pwd; printf "\\033[31mred\\033[0m \\033[33myellow\\033[0m \\033[34mblue\\033[0m\\n"; touch '${printed}'\n`, {
      delay: 5,
    })
    await expect.poll(() => existsSync(printed)).toBe(true)
    await still(page)
    await page.screenshot({ path: 'test-results/terminal-dark.png', scale: 'css' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    // Help me fix it lowers the drawer and puts the prompt in the composer.
    await run
      .getByRole('button', { name: /npm run dev/ })
      .first()
      .click()
    await drawer(page).getByRole('button', { name: 'Help me fix it' }).click()
    await expect(drawer(page)).toHaveCount(0)
    // A run that ended goes with its X at once.
    await run.hover()
    await run.getByRole('button', { name: 'Close npm run dev' }).click()
    await expect(run).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/terminal-line-at-rest.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})

test('Quit asks first while something runs in a terminal, and not for an idle shell', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  // Quit asks, as it does for a person: the other specs' apps quit without asking (support.ts).
  const { electronApp, page, child } = await launch(home, { ALTHAR_QUIT_WITHOUT_ASKING: '0' })
  try {
    await openFirstProject(electronApp, page, repository(home))
    await openTerminal(page)
    await expect(terminalKeys(page)).toBeFocused()
    await page.keyboard.type('sleep 60\n')
    const item = line(page).getByRole('listitem').filter({ hasText: 'meridian' })
    await expect(item).toContainText('sleep')

    await electronApp.evaluate(({ app }) => app.quit())
    const dialog = page.getByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toContainText('Quitting stops what’s running in a terminal.')
    await still(page)
    await dialog.screenshot({ path: 'test-results/terminal-quit-asks.png', scale: 'css' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(item).toContainText('sleep')

    // Ctrl+C in the terminal: the shell is idle again, and Quit doesn't ask.
    await terminalKeys(page).focus()
    await page.keyboard.press('Control+c')
    await expect(item).not.toContainText('sleep')
    // It quits as it is told: a question asked would keep it open.
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) await electronApp.close().catch(() => undefined)
  }
})
