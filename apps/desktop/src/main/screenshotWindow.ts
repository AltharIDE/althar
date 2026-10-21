import { BrowserWindow, type Session, session } from 'electron'

import type { PageWindow } from './screenshots'

/*
 * The window a screenshot is drawn in (screenshots.ts): offscreen, so no one
 * sees it and it draws whatever the screen is doing, in a session of its own
 * that keeps nothing on disk, grants no permission and downloads nothing. It
 * opens no other window and is never one of Althar's own.
 */

let shots: Session | undefined
const sessionOf = () => {
  if (shots !== undefined) return shots
  const made = session.fromPartition('althar-screenshots', { cache: false })
  made.setPermissionRequestHandler((_contents, _permission, answer) => answer(false))
  made.setPermissionCheckHandler(() => false)
  made.on('will-download', (event) => event.preventDefault())
  shots = made
  return made
}

export const pageWindow = (width: number, height: number): PageWindow => {
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    enableLargerThanScreen: true,
    webPreferences: {
      offscreen: true,
      session: sessionOf(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  window.webContents.setAudioMuted(true)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return {
    load: (url) => window.loadURL(url),
    run: (script) => window.webContents.executeJavaScript(script, true),
    resize: (w, h) => window.setContentSize(w, h),
    capture: (rect) => (rect === undefined ? window.webContents.capturePage() : window.webContents.capturePage(rect)),
    title: () => window.webContents.getTitle(),
    close: () => {
      if (!window.isDestroyed()) window.destroy()
    },
  }
}
