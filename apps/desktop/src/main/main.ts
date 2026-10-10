import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defaultProfile, defaultWorktrees } from '@althar/runtime/locations'

import { type AppIcon, DEFAULT_APP_ICON, isAppIcon, readAppIcon, writeAppIcon } from './appIcon'
import { type AppPreferences, DEFAULT_PREFERENCES, isPreferenceKey } from './appPreferences'
import { keepingAwake } from './awake'
import { startDictation } from './dictation'
import { isEdgePlace } from './edge'
import { type Edge, startEdge } from './edgeWindows'
import { dockCount, soundOf, tells } from './notify'
import { readAppPreferences, writeAppPreference } from './preferences'
import { findRepositories, forWindow, placesFor } from './repositories'
import { alertSounds, playSound } from './sounds'
// Where each editor is, from the runtime's list of them, so its icon can be drawn here.
import { bundleOf } from '../runtime/editors'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeImage,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  shell,
  type UtilityProcess,
  utilityProcess,
} from 'electron'

import { hidesAppMenu, windowOptions } from './windowOptions'
import { keyringIsSafe, keyringUnavailable } from './keyring'

/*
 * Electron's main process (docs/architecture/02): windows, the app's
 * lifecycle, and a narrow bridge. It holds no workflow rules and no project
 * state. It starts the runtime in a utility process and restarts it if it
 * crashes, gives each window a message port to it, and on quit asks the
 * runtime to stop its sessions before the app goes. Folders reach the runtime
 * from here, never from the window, which gets a grant for each: one the
 * person picked or dropped, or one of the repositories it found where people
 * keep code (repositories.ts), for the first screen to offer. It seals and
 * opens the runtime's secrets, such as a code host's token, with Electron's
 * safeStorage, whose key the keychain keeps for this app alone: the runtime
 * keeps them sealed and never holds the key. It gives the Dock the icon the
 * person chose, and puts Althar at the edge of the screen (edgeWindows.ts):
 * round the notch, or in the menu bar. It keeps the app's own preferences
 * (appPreferences.ts) and acts on them: the Mac kept awake while work runs
 * (awake.ts), and which notifications show, with a sound or not, and the
 * Dock's count (notify.ts).
 * Dictation's microphone, model and speech process are in dictation.ts.
 */

const here = import.meta.dirname

const SHUTDOWN_GRACE = 20_000
/** Restarts allowed within a minute before a crashing runtime ends the app instead. */
const RESTARTS_PER_MINUTE = 3

let runtime: UtilityProcess | undefined
let quitting = false
let dictation: ReturnType<typeof startDictation> | undefined

/*
 * The end-to-end tests' stand-ins for dictation: a fake speech model
 * (ALTHAR_FAKE_SPEECH), and a microphone the system is never asked about
 * (ALTHAR_FAKE_MICROPHONE, and with the fake model), Chromium's own.
 */
const fakeSpeech = __ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_FAKE_SPEECH === '1'
const fakeMicrophone = fakeSpeech || (__ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_FAKE_MICROPHONE === '1')
if (fakeMicrophone) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}
const restarts: Array<number> = []

/** The profile and worktrees, as the command-line client has them, so both see the same projects. */
const locations = () => ({ profile: defaultProfile(process.env, process.platform), worktrees: defaultWorktrees(process.env) })

// Althar is the name windows, window managers and the desktop see, whichever way the app was started.
app.setName('Althar')

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

/** Grants the runtime has yet to confirm, by request. */
const granting = new Map<string, (grant: string | null) => void>()

interface RuntimeMessage {
  readonly type?: string
  readonly requestId?: string
  readonly grant?: string
  readonly value?: unknown
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

/* Althar's own windows, apart from the edge's pages. */
const windows = new Set<BrowserWindow>()
let edge: Edge | undefined

/** Brings Althar's window forward, a window there is or a new one, from wherever the person is. */
const bringForward = () => {
  const existing = [...windows][0]
  const window = existing ?? openWindow()
  if (window.isMinimized()) window.restore()
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
  if (event._tag === 'Working' && typeof event.working === 'boolean') return awake.working(event.working)
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
  try {
    // On Linux a keyring may be missing: Electron would fall back to plain text (basic_text), which is no seal at all, so it fails like a missing keychain would.
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'keychain'
    if (!safeStorage.isEncryptionAvailable() || !keyringIsSafe(process.platform, backend))
      throw new Error(keyringUnavailable(process.platform))
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

const startRuntime = () => {
  const { profile, worktrees } = locations()
  const child = utilityProcess.fork(join(here, '../runtime/runtime.js'), [], {
    serviceName: 'Althar runtime',
    stdio: 'inherit',
    env: { ...process.env, ALTHAR_PROFILE: profile, ALTHAR_WORKTREES: worktrees, ALTHAR_APP_VERSION: app.getVersion() },
  })
  child.on('message', (message: RuntimeMessage) => {
    if (message.type === 'seal' || message.type === 'open') return seal(child, message)
    if (message.type === 'nudge' && message.event !== undefined) return nudged(message.event)
    if (message.type !== 'folder-allowed' || message.requestId === undefined) return
    granting.get(message.requestId)?.(message.grant ?? null)
    granting.delete(message.requestId)
  })
  child.once('exit', (code) => {
    runtime = undefined
    // Nothing runs without the runtime; a new one says again.
    awake.working(false)
    for (const [requestId, settle] of granting) {
      settle(null)
      granting.delete(requestId)
    }
    if (quitting) return
    // A crash is survivable: reconciliation makes a restart safe, and each window reconnects when it reloads.
    const now = Date.now()
    restarts.push(now)
    while (restarts[0] !== undefined && restarts[0] < now - 60_000) restarts.shift()
    if (restarts.length <= RESTARTS_PER_MINUTE) {
      startRuntime()
      for (const window of BrowserWindow.getAllWindows()) window.webContents.reload()
      return
    }
    dialog.showErrorBox('Althar stopped', `Althar's runtime keeps stopping (code ${code}). Open Althar again to carry on.`)
    app.quit()
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
    },
  })
  windows.add(window)
  window.on('closed', () => {
    windows.delete(window)
    // Off a Mac, closing Althar's last window quits, as it did before the edge kept pages of its own open.
    if (windows.size === 0 && process.platform !== 'darwin') app.quit()
  })
  window.webContents.on('did-finish-load', () => connect(window))
  window.once('ready-to-show', () => window.show())
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

// A folder dropped on the window, by the path the preload read from the drop: only a folder on disk gets a grant.
ipcMain.handle('althar:grant-dropped', async (_event, path: unknown) => {
  if (typeof path !== 'string' || path === '') return null
  const found = await stat(path).catch(() => undefined)
  return found?.isDirectory() === true ? allowFolder(path) : null
})

/* The repositories the first screen offers, by the id the window has for each: only these are granted by id. */
const foundHere = new Map<string, string>()

// The repositories where people keep code on this computer, for the first screen: each by an id, never by its path.
ipcMain.handle('althar:find-repositories', async () => {
  // The end-to-end tests give a home of their own, so what the tester keeps isn't offered.
  const home = process.env.ALTHAR_CODE_HOME || homedir()
  const found = await findRepositories(placesFor(home, process.platform))
  foundHere.clear()
  return forWindow(found, home, (path) => {
    const id = randomUUID()
    foundHere.set(id, path)
    return id
  })
})

// A grant for one of them, once the person ticks it and makes the project: one main found, and nothing else.
ipcMain.handle('althar:grant-found', async (_event, id: unknown) => {
  const path = typeof id === 'string' ? foundHere.get(id) : undefined
  return path === undefined ? null : allowFolder(path)
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

// Where Althar shows while the person is in another app, and whether this Mac has a notch to choose the island by.
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

void app.whenReady().then(() => {
  // Off a Mac the app has no menu bar: no File Edit View Window, and nothing on Alt.
  if (hidesAppMenu(process.platform)) Menu.setApplicationMenu(null)
  // The window asks for nothing but the microphone, to dictate (dictation.ts): no notifications, camera or anything else a page can ask for.
  // Althar's own notifications come from here, as the runtime says something needs the person.
  dictation = startDictation({
    script: join(here, '../speech/speech.js'),
    models: () => join(locations().profile, 'speech'),
    mine: (contents) => [...windows].some((window) => !window.isDestroyed() && window.webContents === contents),
    fakeModel: fakeSpeech,
    fakeMicrophone,
  })
  void showChosenIcon()
  // Plugged in or on battery changes whether the Mac is held awake.
  powerMonitor.on('on-battery', awake.powerChanged)
  powerMonitor.on('on-ac', awake.powerChanged)
  // Linux may not say when the power source changes, so there it is looked at again each minute too.
  if (process.platform === 'linux') setInterval(awake.powerChanged, 60_000).unref()
  startRuntime()
  openWindow()
  edge = startEdge({
    profile: () => locations().profile,
    connect,
    preload: join(here, '../preload/preload.cjs'),
    page: join(here, '../renderer/edge.html'),
    pictures: join(here, '../../resources/tray'),
  })
  app.on('activate', () => {
    if (windows.size === 0) openWindow()
  })
})

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
    app.exit(0)
  })
  child.postMessage({ type: 'shutdown' })
})
