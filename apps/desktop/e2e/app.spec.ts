import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'

/*
 * The app as someone uses it: open a folder as a project, start a task, and
 * talk to its lead, which here is the scripted fake agent (CHARRETTE_FAKE_AGENTS).
 * What is said to it picks what it does.
 */

const app = join(import.meta.dirname, '..')

const launch = async (home: string) => {
  const electronApp = await electron.launch({
    args: [app],
    env: {
      ...process.env,
      CHARRETTE_PROFILE: join(home, 'profile'),
      CHARRETTE_WORKTREES: join(home, 'worktrees'),
      CHARRETTE_FAKE_AGENTS: '1',
    },
  })
  return { electronApp, page: await electronApp.firstWindow() }
}

/** Answers the folder picker with `path`, as if the person chose it. */
const chooseFolder = (electronApp: ElectronApplication, path: string) =>
  electronApp.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog
  }, path)

const say = async (page: Page, words: string) => {
  const box = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
  await box.fill(words)
  await box.press('Enter')
}

test('opens a project, starts a task, and talks to its lead', async () => {
  const home = mkdtempSync(join(tmpdir(), 'charrette-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await chooseFolder(electronApp, repo)
    await expect(page.getByText('Fake')).toHaveCount(0)
    await expect(page.getByText('Claude Code')).toBeVisible()
    await page.screenshot({ path: 'test-results/start.png' })
    await page.getByRole('button', { name: /Open a folder/ }).click()

    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.screenshot({ path: 'test-results/project.png' })
    await page.getByLabel('What should change').fill('Add a retry to the checkout call')
    await page.getByRole('button', { name: 'Start the task' }).click()

    // The lead is briefed first; the fake echoes what it was told.
    await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call' })).toBeVisible()
    await expect(page.getByText(/^echo: /).first()).toBeVisible()

    await say(page, 'hello')
    await expect(page.getByText('Hello', { exact: true })).toBeVisible()

    // An edit inside the worktree: the project's rules allow it without asking.
    await say(page, 'tool')
    await expect(page.getByText('chosen=allow-once')).toBeVisible()
    await expect(page.getByText('hello.txt', { exact: true })).toBeVisible()

    // A deploy is kept for the person: it waits in the thread as a call until it is answered.
    await say(page, 'command-choices')
    await expect(page.getByText('Needs you', { exact: true })).toBeVisible()
    await expect(page.getByText('Needs your permission')).toBeVisible()
    await page.screenshot({ path: 'test-results/call.png' })
    await page.getByRole('button', { name: /^Allow/ }).click()
    await expect(page.getByText('chosen=allow_once')).toBeVisible()
    await expect(page.getByText('Needs you', { exact: true })).toHaveCount(0)

    await say(page, 'think')
    await expect(page.getByRole('button', { name: 'Thought' })).toBeVisible()
    await say(page, 'updates')
    await expect(page.getByText('Write the test')).toBeVisible()
    await page.screenshot({ path: 'test-results/thread.png' })
  } finally {
    await electronApp.close()
  }
})
