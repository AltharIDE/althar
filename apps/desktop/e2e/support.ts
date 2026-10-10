import { join } from 'node:path'

import { _electron as electron, type ElectronApplication, expect, type Page } from '@playwright/test'

/* What the end-to-end tests share: the app launched on a profile of its own, with the fake agents, and the person's ways in. */

const app = join(import.meta.dirname, '..')

/** The hidden menu can finish opening before the main window. Wait for the renderer we intend to drive. */
export const mainWindow = async (electronApp: ElectronApplication) => {
  let page: Page | undefined
  await expect
    .poll(
      () => {
        page = electronApp.windows().find((window) => new URL(window.url()).pathname.endsWith('/renderer/index.html'))
        return page !== undefined
      },
      { message: 'Althar main renderer opens', timeout: 30_000 },
    )
    .toBe(true)
  if (page === undefined) throw new Error('Althar main renderer did not open')
  return page
}

export const launch = async (home: string, env: Record<string, string> = {}, { onboarding = false } = {}) => {
  const electronApp = await electron.launch({
    args: [app],
    env: {
      ...process.env,
      ALTHAR_PROFILE: join(home, 'profile'),
      ALTHAR_WORKTREES: join(home, 'worktrees'),
      ALTHAR_FAKE_AGENTS: '1',
      ...env,
    },
  })
  try {
    const page = await mainWindow(electronApp)
    // Most journeys begin after setup; onboarding tests exercise these steps explicitly.
    if (!onboarding) {
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
    }
    return { electronApp, page }
  } catch (error) {
    // The caller cannot clean up a launch that never returned its app.
    await electronApp.close()
    throw error
  }
}

/** Answers the folder picker with `path`, as if the person chose it. */
export const chooseFolder = (electronApp: ElectronApplication, path: string) =>
  electronApp.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog
  }, path)

export const say = async (page: Page, words: string) => {
  const box = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
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
