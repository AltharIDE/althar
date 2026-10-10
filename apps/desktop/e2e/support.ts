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

export const launch = async (home: string, env: Record<string, string> = {}) => {
  const electronApp = await electron.launch({
    args: [app],
    env: {
      ...process.env,
      ALTHAR_PROFILE: join(home, 'profile'),
      ALTHAR_WORKTREES: join(home, 'worktrees'),
      ALTHAR_FAKE_AGENTS: '1',
      ALTHAR_CODE_HOME: home,
      ...env,
    },
  })
  return { electronApp, page: await mainWindow(electronApp) }
}

/** Answers the folder picker with `path`, as if the person chose it. */
export const chooseFolder = (electronApp: ElectronApplication, path: string) =>
  electronApp.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog
  }, path)

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

/** A ready task opens on what it made: its conversation is the header's other face, not the project's view of that name. */
export const toConversation = async (page: Page) => {
  await page
    .getByRole('radiogroup', { name: 'Face' })
    .getByRole('radio', { name: /Conversation/ })
    .click()
}
