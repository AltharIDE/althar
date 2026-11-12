import { type BrowserWindow, type Session, session as sessions, WebContentsView, type WebContents } from 'electron'

import { canvasAddress, canvasAddressOf, canvasHost, CANVAS_SCHEME, canvasPartitionOf } from '@althar/contracts'

import { allowed } from '../browser/guards'
import type { Rect } from '../browser/devices'
import { serveCanvas } from './serve'

/*
 * HTML canvases beside a conversation (ADR-104): each a WebContentsView the
 * main process owns, laid over the workbench where the window measures, as
 * a page is (ADR-100). A view has no preload; sandbox and context isolation
 * are on, Node and the webview tag off, so it can't reach Althar's bridge or
 * anything Althar keeps. It runs in its project's canvas partition, apart
 * from pages and from Althar's window, and the canvas scheme is handled in
 * that partition's own protocol only, so nothing else can load it. Each view
 * is bound to the window it is in, the conversation it is beside (its key)
 * and the version it was opened at; a version's address always gives the
 * same bytes.
 *
 * What a canvas may reach is the project's network, as its agents have it,
 * but for Althar's own listeners (the runtime's tool server and anything else
 * it serves on this computer), which every request it makes is checked
 * against. Every web permission is refused but writing what the person
 * copies; a download is refused; a navigation off its own version's address
 * doesn't happen in the view, and a web link opens in the person's browser.
 */

/** What a window asks to show beside a conversation: a version of a canvas, by its manifest's digest. */
export interface CanvasTarget {
  readonly projectId: string
  readonly canvasId: string
  readonly version: number
  readonly manifest: string
}

export interface CanvasesOptions {
  /** The artifact store the runtime keeps, under the profile. */
  readonly root: string
  /** Althar's tokens, as `/.althar/tokens.css` serves them. */
  readonly tokens: () => string
  /** The ports Althar's own processes listen on, which no canvas reaches. */
  readonly listening: () => ReadonlySet<number>
  /** Opens a web address in the person's browser. */
  readonly outside: (address: string) => void
}

interface View {
  readonly key: string
  readonly window: BrowserWindow
  readonly view: WebContentsView
  target: CanvasTarget
  shown: boolean
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

/** Whether a request a canvas makes reaches one of Althar's own listeners on this computer, which none may. */
export const reachesAlthar = (address: string, listening: ReadonlySet<number>): boolean => {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return false
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return false
  const host = url.hostname.toLowerCase()
  const loopback = LOOPBACK.has(host) || /^127\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.localhost')
  if (!loopback) return false
  const port = url.port === '' ? (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80) : Number(url.port)
  return listening.has(port)
}

/** Where a navigation inside a canvas view goes: on, within its own version; out, to the person's browser; or nowhere. */
export const canvasNavigation = (address: string, target: CanvasTarget): 'go' | 'outside' | 'refuse' => {
  const asked = canvasAddressOf(address)
  if (asked !== null) return asked.host === canvasHost(target.canvasId) && asked.version === target.version ? 'go' : 'refuse'
  try {
    const { protocol } = new URL(address)
    return protocol === 'http:' || protocol === 'https:' ? 'outside' : 'refuse'
  } catch {
    return 'refuse'
  }
}

export const startCanvases = (options: CanvasesOptions) => {
  const views = new Map<string, View>()
  const prepared = new Set<string>()

  /** The manifest a host's version is shown at, in any view: only what a window opened is served. */
  const opened = (host: string, version: number) => {
    for (const one of views.values())
      if (canvasHost(one.target.canvasId) === host && one.target.version === version) return one.target.manifest
    return null
  }

  /** The project's canvas partition, with the scheme handled in it and every guard on it, once. */
  const sessionOf = (projectId: string): Session => {
    const partition = canvasPartitionOf(projectId)
    const made = sessions.fromPartition(partition)
    if (prepared.has(partition)) return made
    prepared.add(partition)
    made.protocol.handle(CANVAS_SCHEME, serveCanvas(options.root, opened, options.tokens))
    made.setPermissionRequestHandler((_contents, permission, answer) => answer(allowed(permission)))
    made.setPermissionCheckHandler((_contents, permission) => allowed(permission))
    made.on('will-download', (event) => event.preventDefault())
    made.webRequest.onBeforeRequest((details, answer) => answer({ cancel: reachesAlthar(details.url, options.listening()) }))
    return made
  }

  const guard = (one: View, contents: WebContents) => {
    const steer = (event: { preventDefault(): void; readonly url: string }) => {
      const where = canvasNavigation(event.url, one.target)
      if (where === 'go') return
      event.preventDefault()
      if (where === 'outside') options.outside(event.url)
    }
    contents.on('will-navigate', steer)
    contents.on('will-redirect', steer)
    contents.on('will-frame-navigate', (event) => {
      // A frame of the canvas's own version, or of the web, loads as a page's would; anything else stays empty.
      if (event.isMainFrame) return steer(event)
      if (canvasNavigation(event.url, one.target) === 'refuse') event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (canvasNavigation(url, one.target) === 'outside') options.outside(url)
      return { action: 'deny' }
    })
  }

  const make = (key: string, window: BrowserWindow, target: CanvasTarget): View => {
    const view = new WebContentsView({
      webPreferences: {
        session: sessionOf(target.projectId),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
        spellcheck: false,
        autoplayPolicy: 'document-user-activation-required',
      },
    })
    view.setBackgroundColor('#ffffff')
    const one: View = { key, window, view, target, shown: false }
    guard(one, view.webContents)
    views.set(key, one)
    void view.webContents.loadURL(canvasAddress(target.canvasId, target.version, '')).catch(() => undefined)
    window.once('closed', () => close(key))
    return one
  }

  const same = (a: CanvasTarget, b: CanvasTarget) =>
    a.projectId === b.projectId && a.canvasId === b.canvasId && a.version === b.version && a.manifest === b.manifest

  /** Shows a version beside a conversation, at the window's place for it; or hides it, where there is no place. */
  const show = (window: BrowserWindow, key: string, target: CanvasTarget, panel: Rect | null) => {
    let one = views.get(key)
    // Another project's canvas is another partition: its view is made anew.
    if (one !== undefined && (one.window !== window || one.target.projectId !== target.projectId)) {
      close(key)
      one = undefined
    }
    if (one === undefined) one = make(key, window, target)
    else if (!same(one.target, target)) {
      one.target = target
      void one.view.webContents.loadURL(canvasAddress(target.canvasId, target.version, '')).catch(() => undefined)
    }
    if (panel === null || panel.width < 1 || panel.height < 1) {
      if (one.shown) window.contentView.removeChildView(one.view)
      one.shown = false
      return
    }
    const zoom = window.webContents.getZoomFactor()
    one.view.setBounds({
      x: Math.round(panel.x * zoom),
      y: Math.round(panel.y * zoom),
      width: Math.round(panel.width * zoom),
      height: Math.round(panel.height * zoom),
    })
    if (!one.shown) window.contentView.addChildView(one.view)
    one.shown = true
  }

  /** Takes a conversation's canvas view away, and its process with it. */
  const close = (key: string) => {
    const one = views.get(key)
    if (one === undefined) return
    views.delete(key)
    if (!one.window.isDestroyed() && one.shown) one.window.contentView.removeChildView(one.view)
    if (!one.view.webContents.isDestroyed()) one.view.webContents.close()
  }

  /** Loads the shown version again, as it was published: for a canvas that drew itself into a corner. */
  const reload = (key: string) => views.get(key)?.view.webContents.reload()

  return { show, close, reload, opened }
}

export type Canvases = ReturnType<typeof startCanvases>
