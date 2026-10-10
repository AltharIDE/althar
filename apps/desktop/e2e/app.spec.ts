import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, say, toConversation } from './support'

/*
 * The app as someone uses it: open a folder as a project, start a task, and
 * talk to its lead; or ask the coordinator, which plans the task, and follow
 * it through Implement and Review until it is ready. Every agent here is the
 * scripted fake (ALTHAR_FAKE_AGENTS): what is said to it picks what it
 * does, and markers like `[coordinator:plan]` pick the role it plays. GitHub
 * is a fake too, at https://github.test, connected with a pasted token; what
 * is pushed to it lands in a bare repository on disk.
 */

test('opens a project, starts a task, and talks to its lead', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
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
    // Its lead reports Implement done at once, with no review, so what follows is talking to it.
    await page.getByLabel('Anything the lead should know').fill('[lead:finish]')
    await expect(page.getByRole('button', { name: /^Review: Small/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/new-task.png', animations: 'disabled' })
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()

    // Its card shows in the Talk room, and opens the task.
    await page.getByRole('button', { name: /Open task/ }).click()

    // Ready for you; it built nothing, and its Outputs say so, over Althar's light.
    await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call', level: 1 })).toBeVisible()
    await expect(page.getByText('Ready for you')).toBeVisible()
    await page.keyboard.press('o')
    await expect(page.getByRole('heading', { name: 'Nothing changed', level: 2 })).toBeVisible()
    await page.keyboard.press('c')
    // The lead is briefed first, and reports its step; its summary is what shows, its work folded above it.
    await expect(page.getByText('Did the task.')).toBeVisible()

    await say(page, 'hello')
    await expect(page.getByText('Hello', { exact: true })).toBeVisible()

    // The lead's model and how hard it thinks, from the composer: the agent offers them, and says when they change.
    await page.getByRole('button', { name: /^Lead:/ }).click()
    await expect(page.getByRole('radio', { name: /^Claude Small ?, via Claude Code/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/model-picker.png', animations: 'disabled' })
    await page.getByRole('radio', { name: 'High' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Effort changed to high.')).toBeVisible()

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
    // Its fold says how long it worked once the turn has ended; until then it is still working.
    await expect(page.getByRole('button', { name: /^Working for/ })).toHaveCount(0)
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

    // The runtime crashes: the app starts it again and the window reconnects, with nothing in the thread about it.
    const runtimePid = () =>
      electronApp.evaluate(
        ({ app }) => app.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'Althar runtime')?.pid ?? null,
      )
    const killed = await runtimePid()
    expect(killed).not.toBeNull()
    // The window reloads once the new runtime is up: a mark left on this page goes with it.
    await page.evaluate(() => Object.assign(window, { beforeCrash: true }))
    await electronApp.evaluate((_electron, pid) => process.kill(pid, 'SIGKILL'), killed ?? 0)
    await expect.poll(runtimePid, { timeout: 20_000 }).not.toBe(killed)
    await expect.poll(() => page.evaluate(() => 'beforeCrash' in window), { timeout: 20_000 }).toBe(false)
    // Its run passed, so the task is still ready, with no lead running and nothing in the thread about the restart.
    await expect(page.getByText('Ready for you', { exact: true })).toBeVisible()
    await expect(page.getByText(/Althar restarted/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start the lead' })).toHaveCount(0)
    // Nothing to press to start it: what the person says next reaches the new runtime and starts it.
    await expect(page.getByRole('button', { name: 'More for this task' })).toHaveCount(0)
    await say(page, 'hello')
    await expect(page.getByRole('button', { name: 'More for this task' })).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: 'test-results/restarted.png' })
  } finally {
    await electronApp.close()
  }
})

test('asks the coordinator, which plans a task that is implemented, reviewed, settled and ready', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
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
    // Ready, it opens on what it made: its branch, merged here as the person says, and the review it passed.
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByRole('heading', { name: 'Add a retry', level: 1 })).toBeVisible()
    await expect(page.getByText('On its branch')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Merge into main' })).toBeVisible()
    await page.screenshot({ path: 'test-results/outputs.png' })
    await toConversation(page)
    await expect(page.getByText('Did the task.')).toBeVisible()
    await expect(page.getByText('The heading needs fixing.')).toBeVisible()
    await expect(page.getByText(/round 2/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Worked for/ }).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/steps.png' })
  } finally {
    await electronApp.close()
  }
})

test('connects GitHub, and a planned task ends in a draft pull request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  // The project's remote is on the fake GitHub; what is pushed there lands in a bare repository.
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  try {
    await chooseFolder(electronApp, repo)
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // Its remote is on GitHub, which isn't connected yet: nothing says so up front, and the project's menu connects it.
    await expect(page.getByText(/isn't connected to GitHub/)).toHaveCount(0)
    await page.getByRole('button', { name: 'meridian options' }).click()
    await page.getByRole('menuitem', { name: 'Connect GitHub' }).click()

    // GitHub has no sign-in of Althar's in this build, so it takes a token.
    const services = page.getByRole('list', { name: 'Code hosts and trackers' })
    await services.getByRole('button', { name: 'Add a token' }).click()
    await services.getByLabel('GitHub token').fill('github_pat_e2e')
    await page.screenshot({ path: 'test-results/token.png', animations: 'disabled' })
    await services.getByRole('button', { name: 'Save' }).click()
    await expect(services.getByText('Signed in as you')).toBeVisible()
    await expect(page.getByText(/isn't connected to/)).toHaveCount(0)
    await page.screenshot({ path: 'test-results/connected.png', animations: 'disabled' })
    await page.keyboard.press('Escape')

    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue)/ })
    await box.fill('Add a retry to the checkout call. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
    await box.press('Enter')

    // The plan ends in a draft pull request, as the project's host allows.
    await expect(page.getByText(/^Starts in \d+s$/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Draft PR')).toBeVisible()
    await page.screenshot({ path: 'test-results/plan-end.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Start now' }).click()

    // The lead commits nothing itself; Althar commits, pushes and opens the pull request.
    await expect(page.getByText('PR #1')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/pull-request.png', animations: 'disabled' })
    const pushed = execFileSync('git', ['--git-dir', remote, 'branch', '--list'], { encoding: 'utf8' })
    expect(pushed).toMatch(/althar\//)

    // Ready, it opens on its pull request: its files and checks, and marking it ready.
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByText('change.txt')).toBeVisible()
    await expect(page.getByText('None have run yet')).toBeVisible()
    await page.screenshot({ path: 'test-results/change.png', animations: 'disabled' })

    // Marked ready here, it is ready on GitHub, and accepting it is the person's.
    await page.getByRole('button', { name: 'Mark ready for review' }).click()
    await expect(page.getByText('Nothing merges until you accept it')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept and merge' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark ready for review' })).toHaveCount(0)
    await toConversation(page)
    await expect(page.getByText('Opened draft pull request #1.')).toBeVisible()

    // What it changed, file by file, read from its worktree: ⌘D opens it.
    await page.keyboard.press('Meta+d')
    const changes = page.getByRole('dialog', { name: 'Changes' })
    await expect(changes.getByText(/althar\/add-a-retry-to-the-checkout-call into main/)).toBeVisible()
    await expect(changes.getByRole('group', { name: 'change.txt' })).toContainText('change')
    await page.screenshot({ path: 'test-results/changes.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(changes).toHaveCount(0)

    // The task's bar goes back to the project: its board has it ready to accept, and so does the bar.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByText('Ready to accept')).toBeVisible()
    await page.getByRole('button', { name: '1 needs you' }).hover()
    await expect(page.getByRole('list', { name: 'What needs you' })).toContainText('Add a retry to the checkout call')
    await page.screenshot({ path: 'test-results/board.png', animations: 'disabled' })
    // Its card opens the task; accepted on what it made, it is merged, and settles.
    await work.getByRole('button', { name: 'Add a retry to the checkout call' }).click()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    await page.getByRole('button', { name: /Accept and merge/ }).click({ trial: true })
    await page.screenshot({ path: 'test-results/accept.png', animations: 'disabled' })
    await page.getByRole('button', { name: /Accept and merge/ }).click()
    // Back goes to the view it came from, the board.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(page.getByRole('radio', { name: 'Board', checked: true })).toBeVisible()
    await expect(work.getByText('PR #1 merged')).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/settled.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

/*
 * What reaches the person outside the window: a notification when a task is
 * ready or something needs them, while they look elsewhere, which opens it
 * when they click it; and how many things wait, on the Dock. Notifications
 * are caught rather than shown, so the test can read and click them.
 */
declare global {
  // What the stubbed notifications caught, in the main process.
  var shown: Array<{ title: string; body: string }> | undefined
  var clickLast: (() => void) | undefined
  var badge: number | undefined
}

test('notifies the person of a ready task while they look elsewhere, counts it on the Dock, and opens it on a click', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await chooseFolder(electronApp, repo)
    await electronApp.evaluate(({ app, BrowserWindow, Notification }) => {
      globalThis.shown = []
      // Wherever the tests run: not every desktop shows notifications or a count on its launcher.
      Notification.isSupported = () => true
      app.setBadgeCount = (count?: number) => {
        globalThis.badge = count
        return true
      }
      Notification.prototype.show = function (this: Electron.Notification) {
        globalThis.shown?.push({ title: this.title, body: this.body })
        globalThis.clickLast = () => this.emit('click')
      }
      // The person is in another app.
      BrowserWindow.getFocusedWindow = () => null
    })
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Add a retry to the checkout call')
    await page.getByLabel('Anything the lead should know').fill('[lead:finish]')
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 15_000 })

    await expect
      .poll(() => electronApp.evaluate(() => globalThis.shown))
      .toEqual([{ title: 'Add a retry to the checkout call', body: 'Ready: Did the task.' }])
    await expect.poll(() => electronApp.evaluate(() => globalThis.badge)).toBe(1)

    // Clicked, it opens the task.
    await electronApp.evaluate(() => globalThis.clickLast?.())
    await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call', level: 1 })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
