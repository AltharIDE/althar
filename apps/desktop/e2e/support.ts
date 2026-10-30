import { join } from 'node:path'

import { budget } from '@althar/testing/budget'
import { _electron as electron, type ElectronApplication, expect, type Page } from '@playwright/test'

/* What the end-to-end tests share: the app launched on a profile of its own, with the fake agents, and the person's ways in. */

const app = join(import.meta.dirname, '..')

/**
 * Althar's own window. Not `firstWindow()`: where the edge is the menu bar
 * (Linux), its sheet is a page of its own made as the app starts, and on a
 * busy machine it can be the first to appear. A window's address can come
 * after the window, so it reads them all until one is Althar's, and says
 * which were open if none is.
 */
export const mainWindow = async (electronApp: ElectronApplication): Promise<Page> => {
  const isMain = (page: Page) => page.url().split(/[?#]/)[0]?.endsWith('/renderer/index.html') === true
  let found: Page | undefined
  await expect
    .poll(
      () => {
        found = electronApp.windows().find(isMain)
        return found === undefined ? electronApp.windows().map((page) => page.url()) : 'open'
      },
      { message: "Althar's window opens" },
    )
    .toBe('open')
  return found as Page
}

/**
 * Quiet on a Mac unless ALTHAR_E2E_FOREGROUND=1: the app runs clear of the
 * person's desktop, never taking focus or a place on the Dock, so tests can
 * run while they work. In the foreground it shows and behaves as it does for
 * a person. Elsewhere it runs in the foreground: on CI's Linux, under a
 * virtual display with no one at it, quiet runs took three times as long.
 */
const quiet = process.platform === 'darwin' && process.env.ALTHAR_E2E_FOREGROUND !== '1'

/**
 * Launches the app on `home`'s profile. Playwright has the window's `prefers-color-scheme` say light unless told otherwise;
 * `scheme: 'system'` leaves it to the app's own appearance, as it is outside a test.
 */
export const launch = async (home: string, env: Record<string, string> = {}, { scheme }: { readonly scheme?: 'system' } = {}) => {
  // Run from inside an Electron app, as a lead in Althar is, the shell says to run Electron as Node; the app must run as itself.
  // And from inside an agent's sandbox, git is configured for the agent (its proxy, its safe folders): the app's git is its own.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE' && !name.startsWith('GIT_')),
  )
  const electronApp = await electron.launch({
    timeout: budget.medium,
    // Chromium refuses to run as root with its sandbox, as in a container: there, without it.
    args: [app, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    ...(scheme === 'system' ? { colorScheme: null } : {}),
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
  // Playwright gives the config's times to the browsers it starts, not to an app it launches, whose actions would each have
  // 30 s on any machine: a click, or a wait for the window, takes the medium budget, as an assertion does (playwright.config.ts).
  electronApp.context().setDefaultTimeout(budget.medium)
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

/**
 * Text on show. The window keeps the screens of the places the person was on
 * in the page, hidden (`KeptScreens`), and getByText finds text there too: a
 * board's card behind its task, the coordinator's thread behind a lead's.
 */
export const shown = (page: Page, text: string | RegExp, options?: { readonly exact?: boolean }) =>
  page.getByText(text, options).filter({ visible: true })

/**
 * Once the window is still, for a screenshot: the launch has played over it,
 * and every animation and transition that ends (a fold opening, a dialog
 * fading in, lanes easing to their widths) has ended. One that loops, as a
 * spinner does, never ends, and isn't waited for.
 */
export const still = (page: Page) =>
  page.waitForFunction(
    () =>
      document.querySelector('[class*="veil"]') === null &&
      document.getAnimations().every((one) => one.playState !== 'running' || one.effect?.getComputedTiming().endTime === Infinity),
  )

/** Sizes Althar's window, and waits until its page is laid out at the new width. */
export const sizeWindow = async (electronApp: ElectronApplication, page: Page, width: number, height: number) => {
  const made = await electronApp.browserWindow(page)
  const [inner] = await made.evaluate(
    (one, [wide, high]) => {
      one.setSize(wide, high)
      return one.getContentSize()
    },
    [width, height] as const,
  )
  await page.waitForFunction((wide) => window.innerWidth === wide, inner)
}

/**
 * Holds what the window sends the runtime, as a runtime too busy to answer
 * would, until the function it gives back is called; what the runtime sends
 * still arrives. What the window shows meanwhile it had already. React's
 * scheduler wakes itself through a port too, with nothing in the message:
 * that goes through.
 */
export const holdRuntime = async (page: Page) => {
  await page.evaluate(() => {
    const held: Array<() => void> = []
    // oxlint-disable-next-line typescript/unbound-method -- applied to the port it was called on
    const post = MessagePort.prototype.postMessage
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: Parameters<MessagePort['postMessage']>) {
      if (args[0] === null || args[0] === undefined) post.apply(this, args)
      else held.push(() => post.apply(this, args))
    } as MessagePort['postMessage']
    Object.assign(window, {
      release: () => {
        MessagePort.prototype.postMessage = post
        for (const send of held.splice(0)) send()
      },
    })
  })
  return () => page.evaluate(() => (window as unknown as { release: () => void }).release())
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

/** A section of the project's settings: Settings, the last of its views in its header, then the section down the side. */
export const projectSettings = async (page: Page, section: 'General' | 'Code and issues' | 'Rules' | 'Running' | 'Notes') => {
  await page
    .getByRole('radiogroup', { name: 'View' })
    .getByRole('radio', { name: /^Settings/ })
    .click()
  await page
    .getByRole('navigation', { name: 'Project settings' })
    .getByRole('button', { name: new RegExp(`^${section}`) })
    .click()
}

/** From the project's settings back to its work: the conversation with its coordinator. */
export const backToWork = async (page: Page) => {
  await page
    .getByRole('radiogroup', { name: 'View' })
    .getByRole('radio', { name: /^Conversation/ })
    .click()
}

/**
 * Connects the fake GitHub, where the project's work goes, from where its
 * settings say so, with a token pasted as the person would; then back to
 * the conversation.
 */
export const connectGitHub = async (page: Page) => {
  await projectSettings(page, 'Code and issues')
  await page.getByRole('region', { name: 'GitHub' }).getByRole('button', { name: 'Connect GitHub' }).click()
  const connecting = page.getByRole('dialog', { name: 'GitHub' })
  await connecting
    .getByRole('group', { name: 'Ways to connect GitHub' })
    .getByRole('button', { name: /Make a token/ })
    .click()
  await connecting.getByRole('button', { name: 'Paste it myself' }).click()
  await connecting.getByLabel('Paste it').fill('github_pat_e2e')
  await connecting.getByRole('button', { name: 'Check' }).click()
  await expect(connecting.getByRole('heading', { name: 'Connected as you' })).toBeVisible()
  await connecting.getByRole('button', { name: 'Done' }).click()
  await expect(connecting).toHaveCount(0)
  await backToWork(page)
}

/** A ready task opens on what it made: its conversation is the header's other face, not the project's view of that name. */
export const toConversation = async (page: Page) => {
  await page
    .getByRole('radiogroup', { name: 'Face' })
    .getByRole('radio', { name: /Conversation/ })
    .click()
}
