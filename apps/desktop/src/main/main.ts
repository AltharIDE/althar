import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { homedir, hostname, userInfo } from 'node:os'
import { join } from 'node:path'

import { locations as locationsOf } from './locations'

import { type AppIcon, DEFAULT_APP_ICON, isAppIcon, readAppIcon, writeAppIcon } from './appIcon'
import { type AppPreferences, DEFAULT_PREFERENCES, doNotTrack, isPreferenceKey } from './appPreferences'
import { keepingAwake } from './awake'
import { tokenIn } from './clipboard'
import { childKind, type CrashReports, crashReports, goneBadly, type HiddenNames, namesLearned, newDumps } from './crashReports'
import { startDictation } from './dictation'
import { isEdgePlace } from './edge'
import { type Edge, startEdge } from './edgeWindows'
import { startLogs } from './logs'
import { setAppMenu } from './menu'
import { dockCount, soundOf, tells } from './notify'
import { readAppPreferences, writeAppPreference } from './preferences'
import { PICTURE_SCHEME } from './pictureAddress'
import { type Resize, servePicture } from './pictures'
import type { Shot } from '@althar/runtime'
import { pageWindow } from './screenshotWindow'
import { takeScreenshot } from './screenshots'
import { storeFacts } from './report/mainFacts'
import { factsIn, type RuntimeFacts } from './report/facts'
import { factsAsker, startReports } from './report/reports'
import { findRepositories, foundIds, forWindow, placesFor, stillFound } from './repositories'
import { afterExit } from './restarts'
import { alertSounds, playSound } from './sounds'
import { failureForWindow, type StoreFailure, storeFailureOf } from './storeFailure'
import { checkNow, startUpdates } from './updater'
import type { UpdateGlance, Updates } from './updates'
import { installOf, usageData } from './usageData'
import { masker } from '../logs/mask'
// Where each editor is, from the runtime's list of them, so its icon can be drawn here.
import { bundleOf } from '../runtime/editors'

import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  shell,
  type UtilityProcess,
  utilityProcess,
} from 'electron'

import { appMenu, windowOptions } from './windowOptions'
import { keyringIsSafe, keyringUnavailable, passwordStore, sealWithPortal, sealsWithPortal, withPortalFeature } from './keyring'

/*
 * Electron's main process (docs/architecture/02): windows, the app's
 * lifecycle, and a narrow bridge. It holds no workflow rules and no project
 * state. It starts the runtime in a utility process and restarts it if it
 * crashes, gives each window a message port to it, and on quit asks the
 * runtime to stop its sessions before the app goes. Folders reach the runtime
 * from here, never from the window, which gets a grant for each: one the
 * person picked or dropped, or one of the repositories it found where people
 * keep code (repositories.ts), for the first screen and a new project to
 * offer. It seals and opens the runtime's secrets, such as a code host's
 * token, with Electron's safeStorage; in a Flatpak it prefers the app-specific
 * Secret portal key and falls back only to a safe session keyring. The runtime keeps secrets sealed and never
 * holds the key. It gives the Dock the icon the
 * person chose, and puts Althar at the edge of the screen (edgeWindows.ts):
 * round the notch, or in the menu bar. It keeps the app's own preferences
 * (appPreferences.ts) and acts on them: the Mac kept awake while work runs
 * (awake.ts), and which notifications show, with a sound or not, and the
 * Dock's count (notify.ts).
 * Dictation's microphone, model and speech process are in dictation.ts.
 * A packaged app updates itself (updater.ts): it never restarts into an
 * update while work runs, and only when the person asks, or as they quit.
 * Anonymous usage data goes from here alone (usageData.ts): what the runtime
 * says happened, Althar opening and an update installed, each only while
 * the person's switch is on. So do crash reports (crashReports.ts), behind a
 * switch of their own: what main, the window and the runtime couldn't
 * handle, a process that stopped, and a native crash, masked.
 */

const here = import.meta.dirname

const SHUTDOWN_GRACE = 20_000
/** How long focus settles, moving between Althar's windows, before the edge hears whether Althar is in front. */
const FOCUS_SETTLE = 120

let runtime: UtilityProcess | undefined
let quitting = false
let dictation: ReturnType<typeof startDictation> | undefined

/*
 * The end-to-end tests' stand-ins for dictation: a fake speech model
 * (ALTHAR_FAKE_SPEECH), and a microphone the system is never asked about
 * (ALTHAR_FAKE_MICROPHONE, and with the fake model), Chromium's own.
 */
/* The end-to-end tests show the window's failure screen: the runtime isn't started, so no port ever comes. Packaged builds leave this out. */
const noRuntime = __ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_NO_RUNTIME === '1'
const fakeSpeech = __ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_FAKE_SPEECH === '1'
const fakeMicrophone = fakeSpeech || (__ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_FAKE_MICROPHONE === '1')
if (fakeMicrophone) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}
/*
 * The end-to-end tests run quietly (ALTHAR_QUIET), so a person can carry on
 * at their desk while agents run them: no Dock icon, and nothing becomes the
 * active app or takes focus. The window and the island are there but drawn
 * clear and let the pointer through; the tests drive the pages directly,
 * which need neither. No notification reaches the system; a test that wants
 * them puts its own catcher in.
 */
const quiet = __ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_QUIET === '1'
if (quiet) Notification.isSupported = () => false
/* The end-to-end tests' PostHog, on this computer (ALTHAR_FAKE_POSTHOG): usage data goes there, under a key of its own. Packaged builds leave this out. */
const fakePostHog = __ALTHAR_TEST_HOOKS__ ? (process.env.ALTHAR_FAKE_POSTHOG ?? '') : ''
const usageTarget = fakePostHog === '' ? __ALTHAR_USAGE__ : { key: 'phc_fake', host: fakePostHog }
let restarts: ReadonlyArray<number> = []
/* The store an update couldn't move, or a profile another Althar has open, once the runtime says so: every window shows it, and no runtime starts again. */
let storeFailure: StoreFailure | undefined
/* The person asked to try a profile again: the runtime that found it open is stopped, and a new one starts in its place. */
let retrying = false

/** The profile and worktrees, as the command-line client has them: a Flatpak's home is a fresh empty one each run, so it keeps worktrees beside its profile (locations.ts). */
const locations = () => locationsOf(process.env, process.platform, homedir())

// Althar is the name windows, window managers and the desktop see, whichever way the app was started.
app.setName('Althar')

// Off a Mac Electron draws the application menu's bar at the top of every window, frameless or not; the menu is kept for its accelerators (appMenu), and its bar is hidden here (windowOptions.ts, ADR-019).
if (process.platform !== 'darwin') app.on('browser-window-created', (_event, window) => window.setMenuBarVisibility(false))

// Off a Mac, ask for a secret service where Electron would fall back to plain text (keyring.ts).
const store = passwordStore(process.argv, process.env.XDG_CURRENT_DESKTOP, process.env.FLATPAK_ID !== undefined, process.platform)
if (store !== null) app.commandLine.appendSwitch('password-store', store)
// In any Linux Flatpak, sign-ins prefer the app-specific Secret portal key (keyring.ts).
const portal = sealsWithPortal(process.env.FLATPAK_ID !== undefined, process.platform)
if (portal) app.commandLine.appendSwitch('enable-features', withPortalFeature(app.commandLine.getSwitchValue('enable-features')))

/*
 * Where the window keeps what it remembers, its tabs and pinned models. A
 * profile of its own, as the end-to-end tests give, keeps it apart from the
 * person's. Otherwise it stays in the folder it had before the app took its
 * name, Althar (productName, which also names the keychain entry sign-ins
 * are sealed with): Application Support/Althar is where a profile lives.
 */
const ownProfile = process.env.ALTHAR_PROFILE
app.setPath(
  'userData',
  ownProfile !== undefined && ownProfile !== '' ? join(ownProfile, 'window') : join(app.getPath('appData'), '@althar', 'desktop'),
)

/*
 * Native crashes, in any of Althar's processes, as Crashpad's minidumps,
 * kept in the profile's window folder and never uploaded: the next launch
 * says only that one happened, where crash reports are on (crashReports.ts).
 */
crashReporter.start({ uploadToServer: false })

/*
 * One Althar to a profile. A second launch (the Dock, a shortcut, a link)
 * brings the first one's window forward and ends; it starts no runtime of
 * its own, which could not open the profile the first holds. The lock is
 * Electron's, kept per user data folder, which is set above from the
 * profile: Althars on profiles of their own, as the end-to-end tests give,
 * run side by side.
 */
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
/** When the app is ready, in the instance that holds the lock; in a second, never: it quits without opening anything. */
const ready = primary ? app.whenReady() : new Promise<void>(() => {})

/*
 * The app's logs (logs.ts, DEV-61): where the system keeps an app's logs, or
 * in a profile of its own where one was given, so a test's stay with it.
 */
const logs = startLogs({
  dir: ownProfile !== undefined && ownProfile !== '' ? join(ownProfile, 'logs') : app.getPath('logs'),
  passOn: !app.isPackaged,
})
/* What reports ask the runtime (report/reports.ts). */
const facts = factsAsker()

/*
 * Pictures agents hand back reach the window at an address of Althar's own,
 * answered from the artifact store (pictures.ts): a standard, secure scheme,
 * registered before the app is ready, as Electron asks.
 */
protocol.registerSchemesAsPrivileged([{ scheme: PICTURE_SCHEME, privileges: { standard: true, secure: true } }])

/** A smaller copy of a picture, drawn by Chromium's own decoder: a JPEG stays one, anything else becomes a PNG, keeping its transparency. */
const resize: Resize = (bytes, type, width) => {
  const picture = nativeImage.createFromBuffer(bytes)
  if (picture.isEmpty() || picture.getSize().width <= width) return null
  const smaller = picture.resize({ width, quality: 'good' })
  return type === 'image/jpeg' ? { bytes: smaller.toJPEG(85), type } : { bytes: smaller.toPNG(), type: 'image/png' }
}

/** Grants the runtime has yet to confirm, by request. */
const granting = new Map<string, (grant: string | null) => void>()

interface RuntimeMessage {
  readonly type?: string
  readonly requestId?: string
  readonly grant?: string
  readonly value?: unknown
  /** A usage event, as the runtime says it; usageData.ts keeps only what it names. */
  readonly usage?: unknown
  /** What the runtime couldn't handle (runtime/crashes.ts); crashReports.ts reads it. */
  readonly crash?: unknown
  /** A screenshot an agent asked for (screenshots.ts). */
  readonly shot?: Shot
  readonly event?: {
    readonly _tag?: string
    readonly kind?: unknown
    readonly count?: unknown
    readonly working?: unknown
    readonly title?: unknown
    readonly body?: unknown
    readonly threadId?: unknown
  }
}

/* Notifications the person may still click: kept, so they aren't collected before then. */
const shown = new Set<Notification>()

/* The Mac held awake while work runs, by the app-suspension blocker: the display may still sleep. */
const awake = keepingAwake({
  hold: () => powerSaveBlocker.start('prevent-app-suspension'),
  release: (id) => powerSaveBlocker.stop(id),
  onBattery: () => powerMonitor.isOnBatteryPower(),
})

/* Updates, in a packaged app only: its windows hear when one is ready to install. */
let updates: Updates | undefined

/* How many things wait, as the runtime last said, for the Dock's count as it is turned on and off. */
let waiting = 0

/*
 * The app's own preferences: where each starts until the file is read, then
 * as kept. A change waits for that read, so the read can't undo it.
 */
let preferences: AppPreferences = DEFAULT_PREFERENCES
const preferencesRead = readAppPreferences(locations().profile).then((kept) => {
  preferences = kept
  awake.wants(kept)
  // A count the runtime gave before the file was read is shown again as the person has it.
  if (waiting > 0) app.setBadgeCount(dockCount(waiting, kept))
})

/*
 * Anonymous usage data, once the preferences are read, so an event never
 * goes before the person's switch is known (and the install is read after
 * them, so its first write can't race a damaged file's), and once the app
 * is ready, as its network needs: from a release build, while the switch is
 * on and DO_NOT_TRACK isn't set. Its first events: Althar opened,
 * and an update installed when it opens on another version than last time.
 */
const install = preferencesRead.then(() => installOf(locations().profile, app.getVersion()))
const usage = Promise.all([install, ready]).then(([install]) => {
  const sender = usageData({
    ...usageTarget,
    installId: install.id,
    app: { version: app.getVersion(), platform: process.platform, arch: process.arch },
    allowed: () => preferences.usageData && !doNotTrack(process.env),
    fetch: (url, options) => net.fetch(url, options),
  })
  sender.record({ name: 'app_opened' })
  if (install.updatedFrom !== null) sender.record({ name: 'update_installed', properties: { from: install.updatedFrom } })
  return sender
})
const recordUsage = (said: unknown) => void usage.then((sender) => sender.record(said))

/* The projects' and repositories' names to hide, all those learned this launch: the runtime holds the store while it runs, so it is asked; without one, main reads it. */
const names = factsAsker('names')
let namesKnown: HiddenNames = { projects: [], repositories: [] }
const namesNow = async () => {
  let read: Pick<RuntimeFacts, 'projects' | 'repositories'> | null = null
  try {
    read =
      runtime === undefined
        ? storeFacts(locations().profile)
        : factsIn(await Promise.race([names.ask(runtime, null), new Promise((resolve) => setTimeout(() => resolve(null), 2_000))]))
  } catch {
    read = null
  }
  // Added to what was learned, never in its place: a name renamed or removed is hidden still. A store that couldn't be read, or a runtime that couldn't say, adds none.
  namesKnown = namesLearned(namesKnown, read)
  return namesKnown
}

/** What hides the person in a crash report, as Report a problem does: their home, who they are, this computer, and every project's and repository's name learned this launch. */
const maskHere = async () => {
  const known = await namesNow()
  let user: string | undefined
  try {
    user = userInfo().username
  } catch {
    user = undefined
  }
  return masker({
    // The end-to-end tests give a home of their own, as the repositories found do; packaged builds leave this out.
    home: (__ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_CODE_HOME) || homedir(),
    ...(user === undefined ? {} : { user }),
    device: hostname(),
    names: { project: known.projects, repository: known.repositories },
  })
}

/*
 * Crash reports, as usage data: once the preferences and the install are
 * read and the app is ready, from a release build, while their own switch
 * is on and DO_NOT_TRACK isn't set. What fails before then waits for it.
 * Their first: a native crash since the last launch, once each.
 */
const crashes = Promise.all([install, ready]).then(([install]) => {
  const sender = crashReports({
    ...usageTarget,
    installId: install.id,
    app: { version: app.getVersion(), platform: process.platform, arch: process.arch },
    allowed: () => preferences.crashReports && !doNotTrack(process.env),
    fetch: (url, options) => net.fetch(url, options),
    mask: maskHere,
  })
  void newDumps(app.getPath('crashDumps'), locations().profile)
    .then((dumps) => {
      for (const dump of dumps) sender.native(dump)
    })
    .catch(() => undefined)
  return sender
})
/** Reports a crash once the sender is there; reporting never fails into what failed. */
const reportCrash = (report: (sender: CrashReports) => void) => void crashes.then(report).catch(() => undefined)
/** Lets crash reports and usage data on their way go, a few seconds at most. */
const sendersStopped = () =>
  Promise.race([
    Promise.all([usage.then((sender) => sender.stop()), crashes.then((sender) => sender.stop())]),
    new Promise((resolve) => setTimeout(resolve, 4_000)),
  ]).catch(() => undefined)

// Watched, not handled, as the log does (logs.ts): what Electron does with them stays as it was.
process.on('uncaughtExceptionMonitor', (thrown) => reportCrash((sender) => sender.thrown(thrown, 'main', 'uncaught')))
process.on('unhandledRejection', (reason) => reportCrash((sender) => sender.thrown(reason, 'main', 'rejection')))
// The window's own, as it sends them for the log (renderer/shared/windowErrors.ts).
ipcMain.on('althar:window-error', (_event, report: unknown) => reportCrash((sender) => sender.fromWindow(report)))
// A window's page, or a process of Althar's, that crashed or failed; nothing Althar stopped itself, nor anything as it quits.
app.on('render-process-gone', (_event, _contents, details) => {
  if (goneBadly(details.reason) && !quitting) reportCrash((sender) => sender.gone('window', details))
})
app.on('child-process-gone', (_event, details) => {
  if (goneBadly(details.reason) && !quitting) reportCrash((sender) => sender.gone(childKind(details), details))
})

/* Althar's own windows, apart from the edge's pages. */
const windows = new Set<BrowserWindow>()
let edge: Edge | undefined

/** Brings Althar's window forward, a window there is or a new one, from wherever the person is. */
const bringForward = () => {
  const existing = [...windows][0]
  const window = existing ?? openWindow()
  if (window.isMinimized()) window.restore()
  if (quiet) {
    window.showInactive()
    return { window, fresh: existing === undefined }
  }
  // Asked from the edge, Althar isn't the active app: it becomes it.
  app.focus({ steal: true })
  window.show()
  window.focus()
  return { window, fresh: existing === undefined }
}

/** Opens the window on a thread, as a notification or the edge asks. */
const openThread = (threadId: string) => {
  const { window, fresh } = bringForward()
  const send = () => window.webContents.send('althar:open', threadId)
  if (fresh || window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

/**
 * What the runtime says needs the person: a notification of each kind they
 * want told, unless they are looking at the window, where it shows already;
 * and how many things wait, on the Dock while its count is on. Never for
 * progress. And whether any work runs, to keep the Mac awake by.
 */
const nudged = (event: NonNullable<RuntimeMessage['event']>) => {
  if (event._tag === 'Working' && typeof event.working === 'boolean') {
    // Nothing restarts into an update while work runs.
    updates?.working(event.working)
    return awake.working(event.working)
  }
  if (event._tag === 'Waiting' && typeof event.count === 'number') {
    waiting = event.count
    edge?.waiting(event.count)
    return void app.setBadgeCount(dockCount(waiting, preferences))
  }
  if (event._tag !== 'Nudge' || typeof event.title !== 'string' || typeof event.body !== 'string' || typeof event.threadId !== 'string')
    return
  if (!tells(event.kind, preferences) || BrowserWindow.getFocusedWindow() !== null || !Notification.isSupported()) return
  const { threadId } = event
  const notification = new Notification({ title: event.title, body: event.body, ...soundOf(preferences) })
  shown.add(notification)
  notification.on('click', () => {
    shown.delete(notification)
    openThread(threadId)
  })
  notification.on('close', () => shown.delete(notification))
  notification.show()
}

/** Seals a secret for the runtime, or opens one it kept, and answers with the result or why not. */
const seal = (child: UtilityProcess, message: RuntimeMessage) => {
  if (message.requestId === undefined || typeof message.value !== 'string') return
  const { requestId, value } = message
  if (portal)
    return void sealWithPortal(message.type === 'seal', value, safeStorage, process.platform).then((reply) =>
      child.postMessage({ type: 'sealed', requestId, ...reply }),
    )
  // On Linux a keyring may be missing: Electron would fall back to plain text (basic_text), which is no seal at all, so it fails like a missing keychain would.
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'keychain'
  if (!safeStorage.isEncryptionAvailable() || !keyringIsSafe(process.platform, backend)) {
    // Marked: these words are the person's — the window shows them verbatim, and nothing else from here (words.ts).
    return child.postMessage({ type: 'sealed', requestId, error: keyringUnavailable(process.platform), keyring: true })
  }
  try {
    child.postMessage({
      type: 'sealed',
      requestId,
      value:
        message.type === 'seal'
          ? safeStorage.encryptString(value).toString('base64')
          : safeStorage.decryptString(Buffer.from(value, 'base64')),
    })
  } catch (error) {
    child.postMessage({ type: 'sealed', requestId, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Takes a screenshot an agent asked for, offscreen, and answers with it or why not (screenshots.ts). */
const screenshot = (child: UtilityProcess, message: RuntimeMessage) => {
  const { requestId, shot } = message
  if (requestId === undefined || shot === undefined) return
  void takeScreenshot(shot, pageWindow).then(
    (value) => child.postMessage({ type: 'screenshot-taken', requestId, value }),
    (error: unknown) =>
      child.postMessage({ type: 'screenshot-taken', requestId, error: error instanceof Error ? error.message : String(error) }),
  )
}
/* The end-to-end tests take one as an agent would, straight from the main process (e2e/screenshots.spec.ts). Packaged builds leave this out. */
if (__ALTHAR_TEST_HOOKS__)
  (globalThis as unknown as { takeScreenshot: (shot: Shot) => Promise<unknown> }).takeScreenshot = (shot) =>
    takeScreenshot(shot, pageWindow)

const startRuntime = () => {
  const { profile, worktrees } = locations()
  const child = utilityProcess.fork(join(here, '../runtime/runtime.js'), [], {
    serviceName: 'Althar runtime',
    // What it writes goes to runtime.log, and in development on to the terminal too.
    stdio: 'pipe',
    env: {
      ...process.env,
      ALTHAR_PROFILE: profile,
      ALTHAR_WORKTREES: worktrees,
      ALTHAR_APP_VERSION: app.getVersion(),
      ALTHAR_LOGS: logs.dir,
      // The Node the agent adapters run on (ADR-033): the packaged app's own, as its binary doesn't run as Node; in dev, Electron's.
      ...(app.isPackaged
        ? { ALTHAR_NODE: join(process.resourcesPath, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node') }
        : {}),
    },
  })
  logs.keepOutput(child)
  child.once('spawn', () => logs.info('Runtime started', { pid: child.pid }))
  child.on('message', (message: RuntimeMessage) => {
    if (message.type === 'seal' || message.type === 'open') return seal(child, message)
    if (message.type === 'screenshot') return screenshot(child, message)
    if (message.type === 'facts') return facts.answer(message)
    if (message.type === 'names') return names.answer(message)
    if (message.type === 'nudge' && message.event !== undefined) return nudged(message.event)
    if (message.type === 'usage') return recordUsage(message.usage)
    if (message.type === 'crash') return reportCrash((sender) => sender.fromRuntime(message.crash))
    if (message.type === 'store-failed' || message.type === 'profile-in-use') {
      storeFailure = storeFailureOf(message)
      // What stopped it goes in main's log too, so a report of it carries it. A profile in use is the person's to put right, not an error.
      if (storeFailure?.stopped === 'held')
        logs.info('Profile is open in another Althar or the command line', { reason: storeFailure.reason })
      else if (storeFailure !== undefined)
        logs.error('Update couldn’t move the store', { stopped: storeFailure.stopped, reason: storeFailure.reason })
      for (const window of BrowserWindow.getAllWindows()) connect(window)
      return
    }
    if (message.type !== 'folder-allowed' || message.requestId === undefined) return
    granting.get(message.requestId)?.(message.grant ?? null)
    granting.delete(message.requestId)
  })
  child.once('exit', (code) => {
    runtime = undefined
    if (quitting) logs.info('Runtime exited', { code })
    else logs.error('Runtime exited', { code })
    // Nothing runs without the runtime; a new one says again.
    awake.working(false)
    facts.gone()
    names.gone()
    updates?.working(false)
    for (const [requestId, settle] of granting) {
      settle(null)
      granting.delete(requestId)
    }
    // A crash is survivable: reconciliation makes a restart safe, and each window reconnects when it reloads.
    const after = afterExit({ quitting, stopped: storeFailure !== undefined, retrying, restarts, now: Date.now() })
    restarts = after.restarts
    if (after.next === 'stay') return
    if (after.next === 'start') {
      retrying = false
      storeFailure = undefined
      startRuntime()
      for (const window of BrowserWindow.getAllWindows()) window.webContents.reload()
      return
    }
    logs.error('Runtime keeps stopping; quitting', { restarts: restarts.length })
    reportCrash((sender) => sender.keepsStopping(restarts.length, code))
    dialog.showErrorBox('Althar stopped', `Althar's runtime keeps stopping (code ${code}). Open Althar again to carry on.`)
    // Its report gets a moment to go.
    void sendersStopped().finally(() => app.quit())
  })
  runtime = child
}

/** Tells the runtime a folder the person chose, and returns the grant the window opens it by. */
const allowFolder = (path: string): Promise<string | null> =>
  new Promise((resolve) => {
    if (runtime === undefined) return resolve(null)
    const requestId = randomUUID()
    granting.set(requestId, resolve)
    runtime.postMessage({ type: 'allow-folder', requestId, path })
  })

/** Gives a window a port to the runtime: once per page load, so a reload gets a fresh connection. */
const connect = (window: BrowserWindow) => {
  if (storeFailure !== undefined) return window.webContents.send('althar:store-failed', failureForWindow(storeFailure, homedir()))
  if (runtime === undefined) return
  const { port1, port2 } = new MessageChannelMain()
  runtime.postMessage({ type: 'connect' }, [port1])
  window.webContents.postMessage('althar:port', null, [port2])
}

/**
 * Shows the icon on the Dock, where there is one: while Althar runs, the Dock
 * shows this rather than the app's own. A missing picture reads as an empty
 * image, which would blank the Dock, so it fails instead.
 */
const showIcon = (icon: AppIcon) => {
  const picture = nativeImage.createFromPath(join(here, '../../resources/icons', `${icon}.png`))
  if (picture.isEmpty()) throw new Error(`Althar has no picture for the icon ${icon}.`)
  app.dock?.setIcon(picture)
}

/** The chosen icon on the Dock at start; where its picture is gone, the default's; where that is too, the app's own. */
const showChosenIcon = async () => {
  const chosen = await readAppIcon(locations().profile)
  for (const icon of [chosen, DEFAULT_APP_ICON]) {
    try {
      return showIcon(icon)
    } catch {
      // The next one.
    }
  }
}

/** Opens a link from the window in the person's browser: web pages only, never a file or another app's scheme. */
const openOutside = (url: string) => {
  try {
    const parsed = new URL(url)
    const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if (parsed.protocol === 'https:' || local) void shell.openExternal(parsed.toString())
  } catch {
    // Not a URL; nothing to open.
  }
}

/** Althar's picture for the window's icon on Linux, at the size X11 takes: the full-size file would silently overflow the property and leave the window iconless. */
const windowIcon = () => nativeImage.createFromPath(join(here, '../../resources/icons/cobalt.png')).resize({ width: 128, height: 128 })

const openWindow = () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show: false,
    // Off a Mac the window is frameless, its own strip is the chrome (windowOptions.ts), and on Linux it carries Althar's icon.
    ...windowOptions(process.platform, windowIcon()),
    webPreferences: {
      preload: join(here, '../preload/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Drawn clear, it would otherwise count as hidden and be slowed down.
      backgroundThrottling: !quiet,
    },
  })
  if (quiet) {
    window.setOpacity(0)
    window.setIgnoreMouseEvents(true)
  }
  windows.add(window)
  // The window's own buttons say maximize or restore by what the window is (windowOptions.ts).
  window.on('maximize', () => window.webContents.send('althar:maximized', true))
  window.on('unmaximize', () => window.webContents.send('althar:maximized', false))
  window.on('closed', () => {
    windows.delete(window)
    // Off a Mac, closing Althar's last window quits, as it did before the edge kept pages of its own open.
    if (windows.size === 0 && process.platform !== 'darwin') app.quit()
  })
  window.webContents.on('did-finish-load', () => connect(window))
  window.once('ready-to-show', () => (quiet ? window.showInactive() : window.show()))
  // The window shows Althar and nothing else: links open in the browser, and the window never goes anywhere.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openOutside(url)
  })
  void window.loadFile(join(here, '../renderer/index.html'))
  return window
}

ipcMain.handle('althar:pick-folder', async (event, purpose: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  // An account's folder is often hidden, as ~/.codex-work is: those show too.
  const options =
    purpose === 'account'
      ? {
          properties: ['openDirectory' as const, 'showHiddenFiles' as const],
          message: 'Choose the folder the agent keeps this account’s sign-in in',
          defaultPath: homedir(),
        }
      : { properties: ['openDirectory' as const], message: 'Choose a folder in a git repository' }
  const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
  const path = result.canceled ? undefined : result.filePaths[0]
  return path === undefined ? null : allowFolder(path)
})

// Whether the window is maximized, as its own buttons ask.
ipcMain.handle('althar:maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)

// The window's own buttons, from its strip: close, minimize, or maximize and back (windowOptions.ts names the chrome).
ipcMain.on('althar:window', (event, action: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window === null) return
  if (action === 'close') window.close()
  else if (action === 'minimize') window.minimize()
  else if (action === 'toggle-maximize') {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  }
})

// Folders for a new project, several at once: a grant for each, in the order chosen.
ipcMain.handle('althar:pick-folders', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = { properties: ['openDirectory' as const, 'multiSelections' as const], message: 'Choose the project’s folders' }
  const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
  if (result.canceled) return []
  const grants = await Promise.all(result.filePaths.map(allowFolder))
  return grants.filter((grant) => grant !== null)
})

// A folder dropped on the window, by the path the preload read from the drop: only a folder on disk gets a grant.
ipcMain.handle('althar:grant-dropped', async (_event, path: unknown) => {
  if (typeof path !== 'string' || path === '') return null
  const found = await stat(path).catch(() => undefined)
  return found?.isDirectory() === true ? allowFolder(path) : null
})

/* The repositories the first screen and a new project offer, by the id the window has for each: only these are granted by id. */
const foundHere = foundIds()

// The repositories where people keep code on this computer, for the first screen and a new project: each by an id, never by its path.
ipcMain.handle('althar:find-repositories', async () => {
  // The end-to-end tests give a home of their own, so what the tester keeps isn't offered.
  const home = process.env.ALTHAR_CODE_HOME || homedir()
  const found = await findRepositories(placesFor(home, process.platform))
  return forWindow(found, home, foundHere.idOf)
})

// A grant for one of them, once the person ticks or adds it: one main found, still where it was found, and nothing else.
ipcMain.handle('althar:grant-found', async (_event, id: unknown) => {
  const repository = typeof id === 'string' ? foundHere.found(id) : undefined
  const path = repository === undefined ? null : await stillFound(repository)
  return path === null ? null : allowFolder(path)
})

// The person closed whatever had the profile open and asks Althar to try it again: the runtime that found it held stops, and a new one starts.
ipcMain.handle('althar:try-again', () => {
  if (storeFailure?.stopped !== 'held' || retrying) return
  retrying = true
  runtime?.postMessage({ type: 'shutdown' })
})

// Shows the copy of the store from before an update that couldn't move it, in the system's file manager.
ipcMain.handle('althar:show-backup', () => {
  const backup = storeFailure?.backup
  if (typeof backup === 'string') shell.showItemInFolder(backup)
})

// The icon the person chose, or null where there is no Dock to show one; and a new one, shown on the Dock, then kept. Anything else fails, and the window says so.
ipcMain.handle('althar:app-icon', () => (app.dock === undefined ? null : readAppIcon(locations().profile)))
ipcMain.handle('althar:set-app-icon', async (_event, icon: unknown) => {
  if (!isAppIcon(icon)) throw new Error(`Althar has no icon ${String(icon)}.`)
  showIcon(icon)
  await writeAppIcon(locations().profile, icon)
})

// The app's own preferences, as kept; and a change to one, kept, then acted on at once. Anything a key can't hold fails, and the window says so.
ipcMain.handle('althar:preferences', async () => {
  await preferencesRead
  return preferences
})
ipcMain.handle('althar:set-preference', async (_event, key: unknown, value: unknown) => {
  if (!isPreferenceKey(key)) throw new Error(`Althar has no preference ${String(key)}.`)
  await preferencesRead
  // Merged into the preferences as they stand once it is kept, so changes made together each stay.
  const kept = await writeAppPreference(locations().profile, key, value)
  preferences = { ...preferences, [key]: kept }
  awake.wants(preferences)
  app.setBadgeCount(dockCount(waiting, preferences))
  return preferences
})

// An editor's icon, as Finder draws it, by its id; null for one not found. Only editors Althar knows are drawn.
ipcMain.handle('althar:editor-picture', async (_event, id: unknown) => {
  const path = typeof id === 'string' ? bundleOf(id) : null
  if (path === null) return null
  const picture = await nativeImage
    .createThumbnailFromPath(path, { width: 128, height: 128 })
    .catch(() => app.getFileIcon(path, { size: 'normal' }))
  return picture.isEmpty() ? null : picture.toDataURL()
})

// The Mac's alert sounds a notification can play, and one played once, as Settings offers them.
ipcMain.handle('althar:sounds', () => alertSounds())
ipcMain.handle('althar:play-sound', (_event, name: unknown) => playSound(name, undefined, () => shell.beep()))

// A token on the clipboard, while connecting a service waits for one; anything else stays on the clipboard alone.
ipcMain.handle('althar:clipboard-token', async () => tokenIn(await clipboard.readText()))

// An update ready to install, as a window shows it (null where the app doesn't update, as in development); and restarting into it, at the person's word, only while no work runs.
ipcMain.handle('althar:update', () => updates?.glance() ?? null)
ipcMain.handle('althar:update-restart', () => updates?.restart() ?? false)

// Where Althar shows while the person is in another app, and what this computer has room for: a notch to choose the island by, a tray.
ipcMain.handle('althar:edge', () => edge?.state() ?? null)
ipcMain.handle('althar:set-edge', async (_event, place: unknown) => {
  if (!isEdgePlace(place)) throw new Error(`Althar can't show at ${String(place)}.`)
  await edge?.choose(place)
})
// From an edge page: where the island draws, how tall the menu bar's sheet is, and what to open in the window.
ipcMain.on('althar:edge-drawn', (event, rect: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window === null || typeof rect !== 'object' || rect === null) return
  const { x, y, width, height } = rect as Record<string, unknown>
  if ([x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)))
    edge?.drawn(window, { x: x as number, y: y as number, width: width as number, height: height as number })
})
ipcMain.on('althar:edge-size', (event, height: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window !== null && typeof height === 'number') edge?.sized(window, height)
})
ipcMain.on('althar:edge-open', (_event, threadId: unknown) => {
  edge?.settle()
  if (typeof threadId === 'string' && threadId !== '') openThread(threadId)
  else bringForward()
})

void ready.then(() => {
  // Quiet, Althar is never the active app and has no place on the Dock or in the app switcher.
  if (quiet) app.setActivationPolicy?.('accessory')
  // The window asks for nothing but dictation's microphone and the clipboard token it requests while connecting; its notifications come from main.
  dictation = startDictation({
    script: join(here, '../speech/speech.js'),
    models: () => join(locations().profile, 'speech'),
    mine: (contents) => [...windows].some((window) => !window.isDestroyed() && window.webContents === contents),
    fakeModel: fakeSpeech,
    fakeMicrophone,
  })
  // The pictures agents handed back, from the artifact store the runtime keeps in the profile, by digest.
  protocol.handle(PICTURE_SCHEME, servePicture(join(locations().profile, 'artifacts'), resize))
  void showChosenIcon()
  // Plugged in or on battery changes whether the Mac is held awake.
  powerMonitor.on('on-battery', awake.powerChanged)
  powerMonitor.on('on-ac', awake.powerChanged)
  // Linux may not say when the power source changes, so there it is looked at again each minute too.
  if (process.platform === 'linux') setInterval(awake.powerChanged, 60_000).unref()
  if (!noRuntime) startRuntime()
  // A packaged app looks for updates, and tells every window as one is ready.
  // electron-updater supports the Mac's zip, Windows' NSIS installer and the Linux AppImage; deb/rpm use their package managers.
  if (
    app.isPackaged &&
    (process.platform === 'darwin' || process.platform === 'win32' || (process.platform === 'linux' && process.env.APPIMAGE !== undefined))
  )
    updates = startUpdates((glance: UpdateGlance) => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('althar:update', glance)
    })
  // macOS keeps its system menu with the updater command, and Help → Report a Problem…, which opens the dialog in Althar's window, brought forward (report/reports.ts).
  // Elsewhere the hidden app menu keeps zoom, full screen, quit and dev tools' accelerators; Report a problem is at the quick settings' foot and in Settings' About there.
  if (process.platform === 'darwin') {
    const checking = updates
    setAppMenu({
      name: app.name,
      ...(checking === undefined ? {} : { checkForUpdates: () => void checkNow(checking) }),
      report: () => bringForward().window.webContents.send('althar:report'),
    })
  } else {
    const menu = appMenu(process.platform, !app.isPackaged)
    if (menu !== null) Menu.setApplicationMenu(Menu.buildFromTemplate(menu))
  }
  openWindow()
  startReports({
    profile: () => locations().profile,
    // The install's one id, the one usage data keeps (usageData.ts), whether or not its switch is on.
    installId: () => install.then((kept) => kept.id),
    logs: logs.dir,
    askRuntime: (threadId) => facts.ask(runtime, threadId),
    mine: (contents) => [...windows].some((window) => !window.isDestroyed() && window.webContents === contents),
    address: process.env.ALTHAR_REPORT_URL ?? __ALTHAR_REPORT_URL__,
    email: process.env.ALTHAR_REPORT_EMAIL ?? __ALTHAR_REPORT_EMAIL__,
  })
  edge = startEdge({
    profile: () => locations().profile,
    connect,
    open: () => void bringForward(),
    quit: () => app.quit(),
    preload: join(here, '../preload/preload.cjs'),
    page: join(here, '../renderer/edge.html'),
    pictures: join(here, '../../resources/tray'),
    quiet,
  })
  // The edge is for while the person is in another app: it steps aside while one of Althar's windows has focus, on any screen.
  // Moving between Althar's windows blurs one before the other has focus, so it settles first.
  let focusing: ReturnType<typeof setTimeout> | undefined
  const focusChanged = () => {
    clearTimeout(focusing)
    focusing = setTimeout(() => {
      const focused = BrowserWindow.getFocusedWindow()
      edge?.front(focused !== null && windows.has(focused))
    }, FOCUS_SETTLE)
  }
  app.on('browser-window-focus', focusChanged)
  app.on('browser-window-blur', focusChanged)
  focusChanged()
  app.on('activate', () => {
    if (windows.size === 0) openWindow()
  })
})

// A second launch of Althar on this profile: the first one comes forward.
app.on('second-instance', () => void ready.then(bringForward))

// Closing the last window isn't quitting on macOS: the runtime and its work carry on.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Quitting asks the runtime to stop every session and record it, then waits for it, within a limit.
app.on('before-quit', (event) => {
  if (quitting || runtime === undefined) return
  event.preventDefault()
  quitting = true
  dictation?.stop()
  const child = runtime
  const timer = setTimeout(() => {
    child.kill()
    app.exit(0)
  }, SHUTDOWN_GRACE)
  child.once('exit', () => {
    clearTimeout(timer)
    // Usage data and crash reports on their way get a moment to go.
    void sendersStopped().finally(() => app.exit(0))
  })
  child.postMessage({ type: 'shutdown' })
})
