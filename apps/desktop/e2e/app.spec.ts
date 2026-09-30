import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'

/*
 * The app as someone uses it: open a folder as a project, start a task, and
 * talk to its lead; or ask the coordinator, which plans the task, and follow
 * it through Implement and Review until it is ready. Every agent here is the
 * scripted fake (CHARRETTE_FAKE_AGENTS): what is said to it picks what it
 * does, and markers like `[coordinator:plan]` pick the role it plays.
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
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Add a retry to the checkout call')
    await page.getByRole('button', { name: 'Start the task' }).click()

    // Its card shows in the Talk room, and opens the task.
    await page.getByRole('button', { name: /Open task/ }).click()

    // The lead is briefed first; the fake echoes what it was told.
    await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call' })).toBeVisible()
    await expect(page.getByText(/^echo: /).first()).toBeVisible()

    await say(page, 'hello')
    await expect(page.getByText('Hello', { exact: true })).toBeVisible()

    // An edit inside the worktree: the project's rules allow it without asking.
    await say(page, 'tool')
    await expect(page.getByText('chosen=allow-once')).toBeVisible()
    // The turn is over, so its work folds under how long it took.
    await page
      .getByRole('button', { name: /^Worked for/ })
      .last()
      .click()
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
    await expect(page.getByText('Done', { exact: true })).toBeVisible()
    await page
      .getByRole('button', { name: /^Worked for/ })
      .last()
      .click()
    await expect(page.getByRole('button', { name: 'Thought' })).toBeVisible()
    // A turn with nothing to say folds whole once it ends.
    const folds = page.getByRole('button', { name: /^Worked for/ })
    const before = await folds.count()
    await say(page, 'updates')
    await expect(folds).toHaveCount(before + 1)
    await folds.last().click()
    await expect(page.getByText('Write the test')).toBeVisible()
    await page.screenshot({ path: 'test-results/thread.png' })

    // The runtime crashes: the app starts it again, the window reconnects, and the thread says what happened.
    const killed = await electronApp.evaluate(({ app }) => {
      const runtime = app.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'Charrette runtime')
      if (runtime !== undefined) process.kill(runtime.pid, 'SIGKILL')
      return runtime !== undefined
    })
    expect(killed).toBe(true)
    await expect(page.getByText(/Charrette restarted\. The lead stopped with it/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/restarted.png' })
  } finally {
    await electronApp.close()
  }
})

test('asks the coordinator, which plans a task that is implemented, reviewed, settled and ready', async () => {
  const home = mkdtempSync(join(tmpdir(), 'charrette-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await chooseFolder(electronApp, repo)
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue)/ })
    await box.fill('Add a retry to the checkout call. [coordinator:plan] [lead:finish] [review:findings]')
    await box.press('Enter')

    // The plan, with the time it starts on its own; held, it waits.
    await expect(page.getByText(/^Starts in \d+s$/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('It knows the code.')).toBeVisible()
    await page.screenshot({ path: 'test-results/plan.png' })
    await page.getByRole('button', { name: 'Hold' }).click()
    await expect(page.getByText('Held. Starts when you say')).toBeVisible()
    await page.getByRole('button', { name: 'Start', exact: true }).click()

    // Implement, a review with a finding, settling it, and a review that passes: the card says it is ready.
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Fixed the heading.')).toBeVisible()
    await page.screenshot({ path: 'test-results/ready.png' })

    // In the task, the lead's work is folded under what each step reported.
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByRole('heading', { name: 'Add a retry' })).toBeVisible()
    await expect(page.getByText('Did the task.')).toBeVisible()
    await expect(page.getByText('The heading needs fixing.')).toBeVisible()
    await expect(page.getByText(/round 2/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Worked for/ }).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/steps.png' })
  } finally {
    await electronApp.close()
  }
})
