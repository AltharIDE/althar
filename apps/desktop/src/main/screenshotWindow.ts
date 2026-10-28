import { BrowserWindow, type Session, session } from 'electron'

import type { Allowed, PageWindow } from './screenshots'

/*
 * The window a screenshot is drawn in (screenshots.ts): offscreen, so no one
 * sees it and it draws whatever the screen is doing, in a session of its own
 * that keeps nothing on disk, grants no permission and downloads nothing. It
 * opens no other window and is never one of Althar's own, and no frame of it
 * goes, by a redirect or by itself, anywhere `allowed` doesn't.
 */

let shots: Session | undefined
/* Windows drawing a shot now: once none is, what the pages kept goes, so no page's storage is kept from one shot to the next. */
let drawing = 0
const sessionOf = () => {
  if (shots !== undefined) return shots
  const made = session.fromPartition('althar-screenshots', { cache: false })
  made.setPermissionRequestHandler((_contents, _permission, answer) => answer(false))
  made.setPermissionCheckHandler(() => false)
  made.on('will-download', (event) => event.preventDefault())
  shots = made
  return made
}

export const pageWindow = (width: number, height: number, allowed: Allowed): PageWindow => {
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
  // A frame of the page that would go elsewhere stays empty; the page itself, held, draws nothing more, so the shot ends there.
  let strayed: string | null = null
  let held: (why: Error) => void = () => {}
  const refused = new Promise<never>((_, reject) => {
    held = reject
  })
  refused.catch(() => {})
  const hold = (event: { preventDefault(): void; isMainFrame: boolean }, url: string) => {
    if (allowed(url)) return
    event.preventDefault()
    if (!event.isMainFrame || strayed !== null) return
    strayed = url
    held(new Error(`ERR_BLOCKED_BY_CLIENT: ${url}`))
  }
  window.webContents.on('will-frame-navigate', (event) => hold(event, event.url))
  window.webContents.on('will-redirect', (event) => hold(event, event.url))
  drawing += 1
  let closed = false
  return {
    load: (url) => Promise.race([window.loadURL(url), refused]),
    run: (script) => Promise.race([window.webContents.executeJavaScript(script, true), refused]),
    resize: (w, h) => window.setContentSize(w, h),
    capture: (rect) => (rect === undefined ? window.webContents.capturePage() : window.webContents.capturePage(rect)),
    title: () => window.webContents.getTitle(),
    strayed: () => strayed,
    close: () => {
      if (!window.isDestroyed()) window.destroy()
      if (closed) return
      closed = true
      drawing -= 1
      // Every localhost page shot would otherwise keep its cookies, storage and service workers for as long as Althar runs.
      if (drawing === 0) void shots?.clearStorageData().catch(() => undefined)
    },
  }
}
