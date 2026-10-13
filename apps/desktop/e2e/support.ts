import { join } from 'node:path'

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/* What the end-to-end tests share: the app launched on a profile of its own, with the fake agents, and the person's ways in. */

const app = join(import.meta.dirname, '..')

/**
 * Althar's own window. Not `firstWindow()`: where the edge is the menu bar
 * (Linux), its sheet is a page of its own made as the app starts, and on a
 * busy machine it can be the first to appear.
 */
export const mainWindow = async (electronApp: ElectronApplication): Promise<Page> => {
  const isMain = (page: Page) => page.url().split(/[?#]/)[0]?.endsWith('/renderer/index.html') === true
  const deadline = Date.now() + 30_000
  for (;;) {
    const found = electronApp.windows().find(isMain)
    if (found !== undefined) return found
    if (Date.now() > deadline)
      throw new Error(
        `Althar's window didn't open; open: ${electronApp
          .windows()
          .map((page) => page.url())
          .join(', ')}`,
      )
    await electronApp.waitForEvent('window', { timeout: 1_000 }).catch(() => undefined)
  }
}

/**
 * Quiet on a Mac unless ALTHAR_E2E_FOREGROUND=1: the app runs clear of the
 * person's desktop, never taking focus or a place on the Dock, so tests can
 * run while they work. In the foreground it shows and behaves as it does for
 * a person. Elsewhere it runs in the foreground: on CI's Linux, under a
 * virtual display with no one at it, quiet runs took three times as long.
 */
const quiet = process.platform === 'darwin' && process.env.ALTHAR_E2E_FOREGROUND !== '1'

export const launch = async (home: string, env: Record<string, string> = {}) => {
  // Run from inside an Electron app, as a lead in Althar is, the shell says to run Electron as Node; the app must run as itself.
  // And from inside an agent's sandbox, git is configured for the agent (its proxy, its safe folders): the app's git is its own.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE' && !name.startsWith('GIT_')),
  )
  const electronApp = await electron.launch({
    args: [app],
    env: {
      ...inherited,
      ALTHAR_PROFILE: join(home, 'profile'),
      ALTHAR_WORKTREES: join(home, 'worktrees'),
      ALTHAR_FAKE_AGENTS: '1',
      ALTHAR_CODE_HOME: home,
      ...(quiet ? { ALTHAR_QUIET: '1' } : {}),
      ...env,
    },
  })
  return { electronApp, page: await mainWindow(electronApp) }
}

/** Answers the folder picker with `path`, or several, as if the person chose them. */
export const chooseFolder = (electronApp: ElectronApplication, path: string | ReadonlyArray<string>) =>
  electronApp.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: chosen })) as typeof dialog.showOpenDialog
    },
    typeof path === 'string' ? [path] : [...path],
  )

/** Makes the first project of the folder at `path`, added from the first screen as the person would. */
export const openFirstProject = async (electronApp: ElectronApplication, page: Page, path: string) => {
  await chooseFolder(electronApp, path)
  await page.getByRole('button', { name: /Add a folder/ }).click()
  await page.getByRole('button', { name: /Make the project/ }).click()
}

export const say = async (page: Page, words: string) => {
  const box = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
  // A click waits until the window takes input, as it doesn't while the launch plays over it; typing alone wouldn't.
  await box.click()
  await box.fill(words)
  await box.press('Enter')
}

/**
 * Asks the project's coordinator for a task, as the person does: it drafts
 * the task and proposes its plan, a card that starts on its own after a
 * countdown. The fake coordinator titles the task with what is said up to
 * its first . ! or ? (at most 60 characters, as coordinators draft them),
 * plans no review (`[coordinator:plan-no-review]`), and passes `lead`'s
 * markers on to the lead in the task's description.
 */
export const planTask = (page: Page, title: string, lead = '[lead:finish]') => say(page, `${title} [coordinator:plan-no-review] ${lead}`)

/** Starts a task: asks the coordinator for it, and starts its plan at once rather than waiting out the countdown. */
export const startTask = async (page: Page, title: string, lead = '[lead:finish]') => {
  await planTask(page, title, lead)
  // The newest plan is the last in the conversation; any before it have started.
  await page.getByRole('button', { name: 'Start now' }).last().click()
}

/** A ready task opens on what it made: its conversation is the header's other face, not the project's view of that name. */
export const toConversation = async (page: Page) => {
  await page
    .getByRole('radiogroup', { name: 'Face' })
    .getByRole('radio', { name: /Conversation/ })
    .click()
}
