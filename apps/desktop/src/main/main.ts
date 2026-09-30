import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, MessageChannelMain, session, shell, utilityProcess, type UtilityProcess } from 'electron'

/*
 * Electron's main process (docs/architecture/02): windows, the app's
 * lifecycle, and a narrow bridge. It holds no workflow rules and no project
 * state. It starts the runtime in a utility process and restarts it if it
 * crashes, gives each window a message port to it, and on quit asks the
 * runtime to stop its sessions before the app goes. Folders reach the runtime
 * from here, never from the window, which gets a grant for each.
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

const startRuntime = () => {
  const { profile, worktrees } = locations()
  const child = utilityProcess.fork(join(here, '../runtime/runtime.js'), [], {
    serviceName: 'Charrette runtime',
    stdio: 'inherit',
    env: { ...process.env, CHARRETTE_PROFILE: profile, CHARRETTE_WORKTREES: worktrees, CHARRETTE_APP_VERSION: app.getVersion() },
  })
  child.on('message', (message: { readonly type?: string; readonly requestId?: string; readonly grant?: string }) => {
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

ipcMain.handle('charrette:pick-folder', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = { properties: ['openDirectory' as const], message: 'Choose a folder in a git repository' }
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
