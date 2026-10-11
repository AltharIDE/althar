import { app, autoUpdater as squirrel, BrowserWindow, dialog } from 'electron'
import updater from 'electron-updater'

import { type UpdateGlance, type Updates, updating } from './updates'

/*
 * The updater wired to Electron (ADR-023): electron-updater reads the feed,
 * latest-mac.yml on the repository's latest GitHub Release, and downloads
 * the zip it names; Squirrel.Mac checks the new app is signed as this one
 * is, and puts it in place, to install when Althar restarts or quits.
 * Checks run a little after launch, then every four hours, and from the app
 * menu. Only a packaged app updates.
 *
 * ALTHAR_UPDATE_FEED points the updater at another feed instead, an address
 * on this Mac alone: for testing an update against a local server. Squirrel
 * still takes only an update signed as the running app is.
 */

const FIRST_CHECK = 10_000
const EVERY = 4 * 60 * 60 * 1000

/** A feed for testing, at an address on this Mac alone; null for none, or for any other address. */
export const testFeed = (value: string | undefined): string | null => {
  if (value === undefined || value === '') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

/** Starts checking for updates, and says what a window shows of them as it changes. */
export const startUpdates = (changed: (glance: UpdateGlance) => void): Updates => {
  const { autoUpdater } = updater
  autoUpdater.autoDownload = true
  // Squirrel puts a downloaded update in place at once, and it installs as Althar quits.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  const feed = testFeed(process.env.ALTHAR_UPDATE_FEED)
  if (feed !== null) autoUpdater.setFeedURL({ provider: 'generic', url: feed })

  const updates = updating({ check: () => autoUpdater.checkForUpdates(), install: () => autoUpdater.quitAndInstall() }, changed)
  autoUpdater.on('checking-for-update', updates.checking)
  autoUpdater.on('update-available', (info) => updates.available(info.version))
  autoUpdater.on('update-not-available', updates.none)
  autoUpdater.on('error', (error) => updates.failed(error.message))
  // electron-updater's own update-downloaded comes as the zip is down; Squirrel's, once it has checked the app and put it in place.
  squirrel.on('update-downloaded', updates.staged)

  setTimeout(() => void updates.check(), FIRST_CHECK)
  setInterval(() => void updates.check(), EVERY).unref()
  return updates
}

/** The words of the app menu's check, as a dialog says what it found. */
export const checkText = {
  current: 'Althar is up to date',
  currentDetail: (version: string) => `${version} is the newest version.`,
  downloading: (version: string) => `Althar ${version} is downloading`,
  downloadingDetail: 'When it’s ready, a line in the window’s bar says so. It installs when you restart Althar or quit it.',
  ready: (version: string) => `Althar ${version} is ready`,
  readyDetail: 'Restart now to use it. Otherwise it installs when you quit Althar.',
  readyWorking: 'Work is running, so Althar won’t restart now. It installs when you quit Althar, or restart once the work is done.',
  restart: 'Restart',
  later: 'Later',
  ok: 'OK',
  failed: 'Althar couldn’t check for updates',
}

/** The app menu's Check for Updates…: checks now, and says in a dialog what it found, with Restart where an update is ready and nothing runs. */
export const checkNow = async (updates: Updates) => {
  const found = await updates.check()
  const window = BrowserWindow.getFocusedWindow()
  const show = (options: Electron.MessageBoxOptions) =>
    window === null ? dialog.showMessageBox(options) : dialog.showMessageBox(window, options)
  switch (found.kind) {
    case 'none':
    case 'checking':
      return void show({
        type: 'info',
        message: checkText.current,
        detail: checkText.currentDetail(app.getVersion()),
        buttons: [checkText.ok],
      })
    case 'downloading':
      return void show({
        type: 'info',
        message: checkText.downloading(found.version),
        detail: checkText.downloadingDetail,
        buttons: [checkText.ok],
      })
    case 'failed':
      return void show({ type: 'warning', message: checkText.failed, detail: found.why, buttons: [checkText.ok] })
    case 'ready': {
      if (updates.glance().working)
        return void show({ type: 'info', message: checkText.ready(found.version), detail: checkText.readyWorking, buttons: [checkText.ok] })
      const { response } = await show({
        type: 'info',
        message: checkText.ready(found.version),
        detail: checkText.readyDetail,
        buttons: [checkText.restart, checkText.later],
        defaultId: 0,
        cancelId: 1,
      })
      if (response === 0) updates.restart()
    }
  }
}
