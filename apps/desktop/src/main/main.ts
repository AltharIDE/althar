import { homedir } from 'node:os'
import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron'

/*
 * Electron's main process (docs/architecture/02): windows, the app's
 * lifecycle, and a narrow bridge. It holds no workflow rules and no project
 * state. It starts the runtime in a utility process, gives each window a
 * message port to it, and on quit asks the runtime to stop its sessions
 * before the app goes.
 */

const here = import.meta.dirname
const SHUTDOWN_GRACE = 20_000

let runtime: UtilityProcess | undefined
let quitting = false

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

const startRuntime = () => {
  const { profile, worktrees } = locations()
  const child = utilityProcess.fork(join(here, '../runtime/runtime.js'), [], {
    serviceName: 'Charrette runtime',
    stdio: 'inherit',
    env: { ...process.env, CHARRETTE_PROFILE: profile, CHARRETTE_WORKTREES: worktrees, CHARRETTE_APP_VERSION: app.getVersion() },
  })
  child.once('exit', (code) => {
    runtime = undefined
    if (quitting) return
    // Without the runtime the window can do nothing; say so rather than leave it dead.
    dialog.showErrorBox('Charrette stopped', `Charrette's runtime exited (code ${code}). Open Charrette again to carry on.`)
    app.quit()
  })
  runtime = child
}

/** Gives a window a port to the runtime: once per page load, so a reload gets a fresh connection. */
const connect = (window: BrowserWindow) => {
  if (runtime === undefined) return
  const { port1, port2 } = new MessageChannelMain()
  runtime.postMessage({ type: 'connect' }, [port1])
  window.webContents.postMessage('charrette:port', null, [port2])
}

const openWindow = () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(here, '../preload/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.webContents.on('did-finish-load', () => connect(window))
  window.once('ready-to-show', () => window.show())
  // The window shows Charrette and nothing else: no new windows, no navigating away.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  void window.loadFile(join(here, '../renderer/index.html'))
  return window
}

ipcMain.handle('charrette:pick-folder', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = { properties: ['openDirectory' as const], message: 'Choose a folder in a git repository' }
  const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

void app.whenReady().then(() => {
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
