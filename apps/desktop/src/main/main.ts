import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  Notification,
  safeStorage,
  session,
  shell,
  type UtilityProcess,
  utilityProcess,
} from 'electron'

/*
 * Electron's main process (docs/architecture/02): windows, the app's
 * lifecycle, and a narrow bridge. It holds no workflow rules and no project
 * state. It starts the runtime in a utility process and restarts it if it
 * crashes, gives each window a message port to it, and on quit asks the
 * runtime to stop its sessions before the app goes. Folders reach the runtime
 * from here, never from the window, which gets a grant for each. It seals and
 * opens the runtime's secrets, such as a code host's token, with Electron's
 * safeStorage, whose key the keychain keeps for this app alone: the runtime
 * keeps them sealed and never holds the key.
 */

const here = import.meta.dirname
const SHUTDOWN_GRACE = 20_000
/** Restarts allowed within a minute before a crashing runtime ends the app instead. */
const RESTARTS_PER_MINUTE = 3

let runtime: UtilityProcess | undefined
let quitting = false
const restarts: Array<number> = []

const given = (name: string) => (process.env[name] === '' ? undefined : process.env[name])

/** The profile and worktrees, as the command-line client has them, so both see the same projects. */
const locations = () => ({
  profile:
    given('CHARRETTE_PROFILE') ??
    (process.platform === 'darwin'
      ? join(app.getPath('appData'), 'Charrette')
      : join(given('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'), 'charrette')),
  worktrees: given('CHARRETTE_WORKTREES') ?? join(homedir(), 'Charrette'),
})

/** Grants the runtime has yet to confirm, by request. */
const granting = new Map<string, (grant: string | null) => void>()

interface RuntimeMessage {
  readonly type?: string
  readonly requestId?: string
  readonly grant?: string
  readonly value?: unknown
  readonly event?: {
    readonly _tag?: string
    readonly count?: unknown
    readonly title?: unknown
    readonly body?: unknown
    readonly threadId?: unknown
  }
}

/* Notifications the person may still click: kept, so they aren't collected before then. */
const shown = new Set<Notification>()

/** Opens the window on a thread, as a notification the person clicked asks: a window there is, or a new one. */
const openThread = (threadId: string) => {
  const existing = BrowserWindow.getAllWindows()[0]
  const window = existing ?? openWindow()
  const send = () => window.webContents.send('charrette:open', threadId)
  if (existing === undefined || window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * What the runtime says needs the person: a notification, unless they are
 * looking at the window, where it shows already; and how many things wait, on
 * the Dock. Never for progress.
 */
const nudged = (event: NonNullable<RuntimeMessage['event']>) => {
  if (event._tag === 'Waiting' && typeof event.count === 'number') return void app.setBadgeCount(event.count)
  if (event._tag !== 'Nudge' || typeof event.title !== 'string' || typeof event.body !== 'string' || typeof event.threadId !== 'string')
    return
  if (BrowserWindow.getFocusedWindow() !== null || !Notification.isSupported()) return
  const { threadId } = event
  const notification = new Notification({ title: event.title, body: event.body })
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
    if (!safeStorage.isEncryptionAvailable()) throw new Error('The keychain Charrette seals sign-ins with isn’t available.')
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
    serviceName: 'Charrette runtime',
    stdio: 'inherit',
    env: { ...process.env, CHARRETTE_PROFILE: profile, CHARRETTE_WORKTREES: worktrees, CHARRETTE_APP_VERSION: app.getVersion() },
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
    dialog.showErrorBox('Charrette stopped', `Charrette's runtime keeps stopping (code ${code}). Open Charrette again to carry on.`)
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
  window.webContents.postMessage('charrette:port', null, [port2])
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

const openWindow = () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: {
      preload: join(here, '../preload/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.webContents.on('did-finish-load', () => connect(window))
  window.once('ready-to-show', () => window.show())
  // The window shows Charrette and nothing else: links open in the browser, and the window never goes anywhere.
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

ipcMain.handle('charrette:pick-folder', async (event, purpose: unknown) => {
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

// A folder dropped on the window, by the path the preload read from the drop: only a folder on disk gets a grant.
ipcMain.handle('charrette:grant-dropped', async (_event, path: unknown) => {
  if (typeof path !== 'string' || path === '') return null
  const found = await stat(path).catch(() => undefined)
  return found?.isDirectory() === true ? allowFolder(path) : null
})

void app.whenReady().then(() => {
  // The window asks for nothing: no notifications, camera, microphone or anything else a page can ask for.
  // Charrette's own notifications come from here, as the runtime says something needs the person.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  startRuntime()
  openWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
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
