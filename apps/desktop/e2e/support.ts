import { accessSync, constants, existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

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

/** The commands the app runs as it would on any computer: git, Node and its npm, and Bun. */
const TOOLS = ['git', 'node', 'npm', 'npx', 'bun', 'bunx'] as const

/** Where `command` is on the tests' own PATH, if it is. */
const which = (command: string): string | undefined => {
  const name = process.platform === 'win32' ? `${command}.exe` : command
  for (const dir of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    if (dir === '') continue
    try {
      accessSync(join(dir, name), constants.X_OK)
      return join(dir, name)
    } catch {
      // Not here.
    }
  }
  return undefined
}

/**
 * The PATH the app is given: the tools it runs (`TOOLS`), as the tests find them, and the system's own folders, never the
 * folders the tools came from, which on a person's computer hold their agents too (Homebrew's, `~/.local/bin`). Each tool
 * is linked into a folder of `home`'s own. On Windows, where a program linked elsewhere no longer finds what it ships
 * with, each tool's own folder instead, beside the system's.
 */
export const appPath = (home: string): string => {
  if (process.platform === 'win32') {
    const system = (process.env.SystemRoot ?? 'C:\\Windows').toLowerCase()
    const own = (process.env.Path ?? process.env.PATH ?? '').split(delimiter).filter((dir) => dir.toLowerCase().startsWith(system))
    const tools = TOOLS.flatMap((tool) => {
      const at = which(tool)
      return at === undefined ? [] : [dirname(at)]
    })
    return [...new Set([...tools, ...own])].join(delimiter)
  }
  const linked = join(home, '.e2e-path')
  mkdirSync(linked, { recursive: true })
  for (const tool of TOOLS) {
    const at = which(tool)
    if (at !== undefined && !existsSync(join(linked, tool))) symlinkSync(at, join(linked, tool))
  }
  return [linked, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter)
}

/**
 * Where the app's home is: `home`, so nothing of the person's (their agents' folders and sign-ins, their git config,
 * `~/Documents`) is what a test finds. On Windows Node reads it from USERPROFILE, and npm's global commands from APPDATA.
 */
const homeIn = (home: string): Record<string, string> =>
  process.platform === 'win32' ? { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming') } : { HOME: home }

/**
 * Launches the app on `home`'s profile, with `home` as its home and a PATH without the person's agents (`appPath`), so
 * what a test finds is what it set up, not what this computer has installed. Playwright has the window's `prefers-color-scheme` say light unless told otherwise;
 * `scheme: 'system'` leaves it to the app's own appearance, as it is outside a test.
 */
/** What names the desktop to the app (main/desktop.ts), left out of what a spec's app inherits. */
const DESKTOP_NAMES = [
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_DESKTOP',
  'DESKTOP_SESSION',
  'KDE_FULL_SESSION',
  'KDE_SESSION_VERSION',
  'GNOME_SHELL_SESSION_MODE',
  'SWAYSOCK',
  'I3SOCK',
  'HYPRLAND_INSTANCE_SIGNATURE',
  'NIRI_SOCKET',
]

export const launch = async (
  home: string,
  env: Record<string, string> = {},
  { scheme, switches = [] }: { readonly scheme?: 'system'; readonly switches?: ReadonlyArray<string> } = {},
) => {
  // Run from inside an Electron app, as a lead in Althar is, the shell says to run Electron as Node; the app must run as itself.
  // And from inside an agent's sandbox, git is configured for the agent (its proxy, its safe folders): the app's git is its own.
  // Windows names it Path, and a second spelling beside it would leave which one the app reads to chance.
  // And the desktop it runs on is none the app knows (main/desktop.ts), as CI's virtual display is: the window draws its own
  // buttons, all three, whatever desktop the person running the specs is on (KWin's frame would draw none, GNOME close alone).
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        name !== 'ELECTRON_RUN_AS_NODE' && !name.startsWith('GIT_') && name.toUpperCase() !== 'PATH' && !DESKTOP_NAMES.includes(name),
    ),
  )
  const electronApp = await electron.launch({
    timeout: budget.medium,
    // Chromium refuses to run as root with its sandbox, as in a container: there, without it.
    // And Chromium's switches a spec asks for, as for a camera where the machine has none.
    args: [app, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), ...switches],
    ...(scheme === 'system' ? { colorScheme: null } : {}),
    env: {
      ...inherited,
      ...homeIn(home),
      PATH: appPath(home),
      ALTHAR_PROFILE: join(home, 'profile'),
      ALTHAR_WORKTREES: join(home, 'worktrees'),
      ALTHAR_FAKE_AGENTS: '1',
      ALTHAR_CODE_HOME: home,
      // Closing the app with work running would otherwise wait on Quit's question; only quit.spec.ts asks it (ALTHAR_QUIT_WITHOUT_ASKING=0).
      ALTHAR_QUIT_WITHOUT_ASKING: '1',
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

/** Past the welcome's tour, where it shows: on a profile that hasn't seen it. Then the welcome is on its agents. */
export const pastTheTour = async (page: Page) => {
  const skip = page.getByRole('button', { name: 'Skip', exact: true })
  const agents = page.getByRole('heading', { name: 'Your agents', level: 1 })
  await expect(skip.or(agents).first()).toBeVisible()
  if (await skip.isVisible()) await skip.click()
  await expect(agents).toBeVisible()
}

/** Past the welcome's tour and its agents, to its first project's step. */
export const toFirstProject = async (page: Page) => {
  await pastTheTour(page)
  await page.getByRole('button', { name: /^Continue/ }).click()
}

/** Past the welcome's code host and tracker, where a tracker can be connected, opening the project made on it. */
export const openMadeProject = async (page: Page) => {
  const on = page.getByRole('button', { name: /^(Not now|Continue)$/ })
  const open = page.getByRole('button', { name: /^Open (?!a project$)/ })
  await expect(on.or(open).first()).toBeVisible()
  if (await on.isVisible()) await on.click()
  await open.click()
}

/** Makes the first project of the folder at `path`, added on the welcome as the person would, and opens it. */
export const openFirstProject = async (electronApp: ElectronApplication, page: Page, path: string) => {
  await toFirstProject(page)
  await chooseFolder(electronApp, path)
  await page.getByRole('button', { name: /Choose a folder/ }).click()
  // Ticked once found: one repository, or each of a folder of several.
  await expect(
    page.getByRole('list', { name: 'Repositories for the project' }).getByRole('checkbox', { checked: true }).first(),
  ).toBeVisible()
  await page.getByRole('button', { name: /Make the project/ }).click()
  await openMadeProject(page)
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

/** The header's ⋯, where the home's layout is: its panes, and which side the conversation is on. */
const moreMenu = (page: Page) => page.getByRole('menu', { name: 'More' })
export type LayoutItem = 'Conversation' | 'Board' | 'Conversation on the right'
export const layoutItem = (page: Page, name: LayoutItem) => moreMenu(page).getByRole('menuitemcheckbox', { name, exact: true })

/** Opens the header's ⋯ at its Layout. */
export const openLayout = async (page: Page) => {
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(moreMenu(page)).toBeVisible()
}

/** Closes the header's ⋯ unpicked. */
export const closeLayout = async (page: Page) => {
  await page.keyboard.press('Escape')
  await expect(moreMenu(page)).toHaveCount(0)
}

/** Picks one of the Layout checks in the header's ⋯: a pane, to show or hide it, or which side the conversation is on. */
export const pickLayout = async (page: Page, name: LayoutItem) => {
  await openLayout(page)
  await layoutItem(page, name).click()
  await expect(moreMenu(page)).toHaveCount(0)
}

/** The project's home with these of its panes showing, from ⋯: those wanted on first, so one always shows. */
export const showPanes = async (page: Page, want: { conversation: boolean; board: boolean }) => {
  const panes = [['Conversation', want.conversation] as const, ['Board', want.board] as const]
  for (const [name, on] of [...panes.filter(([, on]) => on), ...panes.filter(([, on]) => !on)]) {
    await openLayout(page)
    const item = layoutItem(page, name)
    if (((await item.getAttribute('aria-checked')) === 'true') !== on) {
      await item.click()
      await expect(moreMenu(page)).toHaveCount(0)
    } else await closeLayout(page)
  }
  await expectPanes(page, want)
}

/** The home's panes showing are these, as ⋯ says. */
export const expectPanes = async (page: Page, shown: { conversation: boolean; board: boolean }) => {
  await openLayout(page)
  await expect(layoutItem(page, 'Conversation')).toHaveAttribute('aria-checked', String(shown.conversation))
  await expect(layoutItem(page, 'Board')).toHaveAttribute('aria-checked', String(shown.board))
  await closeLayout(page)
}

export const say = async (page: Page, words: string) => {
  const box = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
  // A click waits until the window takes input, as it doesn't while the launch plays over it; typing alone wouldn't.
  await box.click()
  await box.fill(words)
  await box.press('Enter')
}

/**
 * Moves a chat the coordinator started at once off Scratch and onto the board, as the person does (a task is a
 * conversation plus parts, "Asides"): beside the conversation, from its pill over it, then Make it a task; the board alone,
 * from the chip heading Up next, its row, then More for this task, and back.
 */
export const toBoard = async (page: Page, title: string) => {
  const work = page.getByRole('region', { name: 'The project’s work' })
  const asides = page.getByRole('tablist', { name: 'Conversations' }).filter({ visible: true })
  if ((await asides.count()) > 0) {
    await asides.getByRole('tab', { name: title }).click()
    await page.getByRole('button', { name: 'Make it a task' }).click()
    await expect(asides.getByRole('tab', { name: title })).toHaveCount(0)
    return
  }
  await work.getByRole('button', { name: /^Asides · / }).click()
  await page.getByRole('list', { name: 'Asides' }).getByRole('listitem').filter({ hasText: title }).getByRole('button').first().click()
  await page.getByRole('button', { name: 'More for this task' }).click()
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /^Move to the board/ })
    .click()
  await page.getByRole('button', { name: /^Back to / }).click()
  await expect(work.getByRole('button', { name: /^Asides · / })).toHaveCount(0)
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
  // Wait for this task's plan to be on show before pressing its Start now: before it is, the last one is another plan's,
  // and pressing that starts nothing of this task's while leaving it to count down. Its title is exactly the task's; what
  // the person said carries the markers too, so isn't.
  await expect(shown(page, title, { exact: true }).last()).toBeVisible()
  // The newest plan is the last in the conversation; any before it have started.
  await page.getByRole('button', { name: 'Start now' }).last().click()
}

/** A section of the project's settings: Settings, the last of its views in its header, then the section down the side. */
export const projectSettings = async (page: Page, section: 'General' | 'Code and issues' | 'Tasks' | 'Rules' | 'Running' | 'Notes') => {
  await page
    .getByRole('radiogroup', { name: 'View' })
    .getByRole('radio', { name: /^Settings/ })
    .click()
  await page
    .getByRole('navigation', { name: 'Project settings' })
    .getByRole('button', { name: new RegExp(`^${section}`) })
    .click()
}

/** From the project's settings back to its work: home, with the conversation with its coordinator showing. */
export const backToWork = async (page: Page) => {
  await pickLayout(page, 'Conversation')
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
}

/**
 * Has the project ask about more than what can't be undone, as it did before
 * allowing everything was the default (ADR-097): from its Rules' What asks;
 * then back to the conversation.
 */
export const askAboutMore = async (page: Page) => {
  await projectSettings(page, 'Rules')
  await page.getByRole('button', { name: 'Ask about more' }).click()
  await page.getByRole('listitem', { name: 'The rest' }).waitFor()
  await backToWork(page)
}

/** Leaves what the lead commits for the person's Push, as before it went up on its own (ADR-072); then back to the conversation. */
export const pushByHand = async (page: Page) => {
  await projectSettings(page, 'Tasks')
  const pushes = page.getByRole('switch', { name: 'Push the lead’s commits automatically' })
  await pushes.click()
  await expect(pushes).not.toBeChecked()
  await backToWork(page)
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
