import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type BrowserWindow, type NativeImage, type Session, session as sessions, WebContentsView, type WebContents } from 'electron'

import { BOARDS_GROUND, canvasAddress, canvasAddressOf, canvasHost, CANVAS_SCHEME, canvasPartitionOf } from '@althar/contracts'

import type { GroundChange, GroundNews, GroundPart, GroundPin, GroundState } from '../../overlay/ground'
import { allowed } from '../browser/guards'
import type { Rect } from '../browser/devices'
import { cropOf, pickedOf, scaled } from '../browser/picked'
import { boardsAt, type CanvasGroundNews, type CanvasPointed } from './boards'
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
 *
 * A canvas of boards loads Althar's own empty page at the version's address
 * instead of its entry, and Althar's ground (src/overlay/ground.ts) runs in
 * an isolated world of it, where the page and its boards never see it: it
 * lays out the boards, and says what the person does there, which goes to
 * the window showing it.
 */

/** What a window asks to show beside a conversation: a version of a canvas, by its manifest's digest. */
export interface CanvasTarget {
  readonly projectId: string
  readonly canvasId: string
  readonly version: number
  readonly manifest: string
  /** A canvas of boards, drawn on Althar's ground rather than from its entry. */
  readonly boards?: boolean
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
  /** The chip's script (src/overlay/chip.ts), run in a page canvas's isolated world beside a conversation. */
  readonly chip?: () => string
  /** The ground's script (src/overlay/ground.ts), run in a canvas of boards' isolated world. */
  readonly ground?: () => string
  /** Tells the window showing a canvas of boards what its ground said. */
  readonly tell?: (window: BrowserWindow, key: string, news: CanvasGroundNews) => void
  /** Where pictures of versions as drawn are kept, for the cards of the project's Artifacts view. */
  readonly stills?: string
}

/** How long after a version's page loads its picture is taken, so its boards have drawn and fitted. */
const STILL_AFTER_MS = 1_800
/** How wide a card's picture is kept. */
const STILL_WIDTH = 640

interface View {
  readonly key: string
  readonly window: BrowserWindow
  readonly view: WebContentsView
  target: CanvasTarget
  shown: boolean
  /** How many times its page has loaded: a ground's news from an earlier load is let go. */
  loads: number
  /** What the window last asked of its ground, kept to lay the boards out the same after a reload. */
  wanted: Partial<GroundState>
  /** The pins the window last asked for. */
  pins: ReadonlyArray<GroundPin>
  /** Beside a conversation, what its chip shows (its ground's, or a page's own); null for none. */
  chip: Chip | null
  /** The load whose chip is heard, for a page: one loop a load. */
  chipHeard: number
}

/** A canvas's chip beside a conversation: its name, and whether it takes a comment on all of it there. */
interface Chip {
  readonly title: string
  readonly comment: boolean
}

/** The isolated world the ground runs in: neither the page's (0) nor Electron's for a preload (999). */
const GROUND_WORLD = 7_311

/** The widest a comment's crop is kept, in pixels. */
const CROP_WIDEST = 1_600

const dataUrl = (picture: NativeImage, kind: 'png' | 'jpeg') =>
  kind === 'png'
    ? `data:image/png;base64,${picture.toPNG().toString('base64')}`
    : `data:image/jpeg;base64,${picture.toJPEG(82).toString('base64')}`

const smaller = (picture: NativeImage) => {
  const { width } = picture.getSize()
  return width > CROP_WIDEST ? picture.resize({ width: CROP_WIDEST, quality: 'good' }) : picture
}

/** Where a version is loaded: its entry, or Althar's ground for a canvas of boards. */
export const loadAddress = (target: CanvasTarget) =>
  canvasAddress(target.canvasId, target.version, target.boards === true ? BOARDS_GROUND : '')

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
  const downloads = new Set<CanvasTarget>()
  const prepared = new Set<string>()
  /* The conversations whose canvas has something of the window's own over its place (ADR-100). Kept apart from the views, so a view made anew (another project's canvas) is still aside while it is. */
  const covered = new Set<string>()

  /** Only versions a window is showing or downloading are served in its project. */
  const opened = (host: string, version: number, projectId?: string) => {
    const matches = (target: CanvasTarget) =>
      (projectId === undefined || target.projectId === projectId) && canvasHost(target.canvasId) === host && target.version === version
    for (const one of views.values()) if (matches(one.target)) return one.target.manifest
    for (const target of downloads) if (matches(target)) return target.manifest
    return null
  }

  /** The project's canvas partition, with the scheme handled in it and every guard on it, once. */
  const sessionOf = (projectId: string): Session => {
    const partition = canvasPartitionOf(projectId)
    const made = sessions.fromPartition(partition)
    if (prepared.has(partition)) return made
    prepared.add(partition)
    made.protocol.handle(
      CANVAS_SCHEME,
      serveCanvas(options.root, (host, version) => opened(host, version, projectId), options.tokens),
    )
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

  /* Each conversation's chip, as the window last asked: a view made after the ask, or made again, takes it. */
  const chips = new Map<string, Chip>()

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
    view.setVisible(!covered.has(key))
    const one: View = {
      key,
      window,
      view,
      target,
      shown: false,
      loads: 0,
      wanted: {},
      pins: [],
      chip: chips.get(key) ?? null,
      chipHeard: 0,
    }
    guard(one, view.webContents)
    views.set(key, one)
    // Each load of a canvas of boards starts its ground afresh, as a load starts its isolated world afresh.
    view.webContents.on('did-finish-load', () => {
      one.loads += 1
      if (one.target.boards === true) void ground(one, one.loads)
      else if (one.chip !== null) void pageChip(one, one.loads)
      keepStill(one, one.loads)
    })
    void view.webContents.loadURL(loadAddress(target)).catch(() => undefined)
    window.once('closed', () => close(key))
    return one
  }

  /* ——— A picture of each version as drawn, for its card ——— */

  const kept = new Set<string>()
  const stillPath = (manifest: string) => (options.stills === undefined ? null : join(options.stills, `${manifest}.jpg`))

  /** Keeps a picture of the version as it shows, once a version, a moment after it loads, where nothing of the window's is over it. */
  const keepStill = (one: View, load: number) => {
    const manifest = one.target.manifest
    const path = stillPath(manifest)
    if (path === null || kept.has(manifest)) return
    setTimeout(() => {
      if (views.get(one.key) !== one || one.loads !== load || !one.shown || covered.has(one.key) || one.view.webContents.isDestroyed())
        return
      if (one.target.manifest !== manifest || kept.has(manifest)) return
      kept.add(manifest)
      void (async () => {
        const picture = await one.view.webContents.capturePage().catch(() => null)
        if (picture === null || picture.isEmpty()) return void kept.delete(manifest)
        const { width } = picture.getSize()
        const small = width > STILL_WIDTH ? picture.resize({ width: STILL_WIDTH, quality: 'good' }) : picture
        await mkdir(options.stills ?? '', { recursive: true })
        await writeFile(path, small.toJPEG(80))
      })().catch(() => kept.delete(manifest))
    }, STILL_AFTER_MS)
  }

  /** The picture kept of a version as drawn, as a data address; null where none was kept. */
  const picture = async (manifest: string): Promise<string | null> => {
    const path = stillPath(manifest)
    if (path === null) return null
    const bytes = await readFile(path).catch(() => null)
    return bytes === null ? null : `data:image/jpeg;base64,${bytes.toString('base64')}`
  }

  /* ——— A canvas of boards' ground ——— */

  const run = <T>(one: View, code: string): Promise<T> =>
    one.view.webContents.executeJavaScriptInIsolatedWorld(GROUND_WORLD, [{ code }], false) as Promise<T>
  const live = (one: View, load: number) => views.get(one.key) === one && one.loads === load && !one.view.webContents.isDestroyed()
  const send = (one: View, news: CanvasGroundNews) => {
    if (!one.window.isDestroyed()) options.tell?.(one.window, one.key, news)
  }

  /** Starts the ground on a load of a canvas of boards, and passes on what it says until the next load. */
  const ground = async (one: View, load: number) => {
    const script = options.ground?.()
    // What this load is of: each part pointed at in it is on that version, however long its picture takes.
    const loaded = { canvasId: one.target.canvasId, version: one.target.version }
    const boards = await boardsAt(options.root, one.target.manifest)
    if (script === undefined || boards === null || !live(one, load)) return
    const started = await run<GroundNews>(
      one,
      `${script}\n;globalThis.__altharGround.start(${JSON.stringify(boards.pages)}, ${JSON.stringify(one.wanted)})`,
    ).catch(() => null)
    if (started === null || !live(one, load)) return
    if (one.pins.length > 0) void run(one, `globalThis.__altharGround.pins(${JSON.stringify(one.pins)})`).catch(() => undefined)
    if (one.chip !== null) void run(one, `globalThis.__altharGround.set(${JSON.stringify({ chip: one.chip })})`).catch(() => undefined)
    send(one, { kind: 'state', state: started.state })
    let seq = started.seq
    while (live(one, load)) {
      const news = await run<GroundNews>(one, `globalThis.__altharGround.next(${seq})`).catch(() => null)
      if (news === null || !live(one, load)) return
      seq = news.seq
      one.wanted = { view: news.state.view, page: news.state.page, board: news.state.board, tool: news.state.tool }
      for (const event of news.events) {
        if (event.kind === 'pointed') {
          const pointed = await pictureOf(one, event, loaded)
          if (pointed !== null && live(one, load)) {
            send(one, { kind: 'pointed', pointed })
            // The comment is written in the window: the keyboard goes back to it.
            one.window.webContents.focus()
          }
        } else send(one, event)
      }
      send(one, { kind: 'state', state: news.state })
    }
  }

  /** A part pointed at, with a crop of it and a picture of the canvas to write over, in the window's pixels. */
  const pictureOf = async (
    one: View,
    part: GroundPart,
    loaded: { readonly canvasId: string; readonly version: number },
  ): Promise<CanvasPointed | null> => {
    const picked = pickedOf(part.picked)
    if (picked === null) return null
    const contents = one.view.webContents
    const bounds = one.view.getBounds()
    const crop = cropOf(
      { x: Math.round(part.at.x), y: Math.round(part.at.y), width: Math.round(part.at.width), height: Math.round(part.at.height) },
      { width: bounds.width, height: bounds.height },
    )
    // A picture the compositor can't give leaves the comment without its crop, never without the comment.
    const [still, cropped] = await Promise.all([
      contents.capturePage().catch(() => null),
      crop === null ? Promise.resolve(null) : contents.capturePage(scaled(crop, 1)).catch(() => null),
    ])
    const shown = cropped === null || cropped.isEmpty() ? null : smaller(cropped)
    const zoom = one.window.webContents.getZoomFactor()
    return {
      ...loaded,
      page: part.page,
      board: part.board,
      picked,
      crop: shown === null ? null : dataUrl(shown, 'png'),
      cropSize: shown === null ? null : shown.getSize(),
      still: still === null || still.isEmpty() ? '' : dataUrl(still, 'jpeg'),
      at: { x: part.at.x / zoom, y: part.at.y / zoom, width: part.at.width / zoom, height: part.at.height / zoom },
    }
  }

  const boardsView = (key: string) => {
    const one = views.get(key)
    return one === undefined || one.target.boards !== true || one.view.webContents.isDestroyed() ? null : one
  }

  /** Changes how a canvas of boards shows: its view, page, board, zoom or tool. */
  const change = (key: string, asked: GroundChange) => {
    const one = boardsView(key)
    if (one === null) return
    const { zoom: _zoom, step: _step, ...kept } = asked
    one.wanted = { ...one.wanted, ...kept }
    void run(one, `globalThis.__altharGround?.set(${JSON.stringify(asked)})`).catch(() => undefined)
  }

  /**
   * A page's chip beside a conversation (src/overlay/chip.ts): shown with its name, or taken away; its presses heard as
   * the ground's keys are, until the next load.
   */
  const pageChip = async (one: View, load: number) => {
    const script = options.chip?.()
    if (script === undefined || !live(one, load)) return
    const shown = await run<{ readonly seq: number }>(one, `${script}\n;globalThis.__altharChip.show(${JSON.stringify(one.chip)})`).catch(
      () => null,
    )
    if (shown === null || !live(one, load) || one.chipHeard === load) return
    one.chipHeard = load
    let seq = shown.seq
    while (live(one, load)) {
      const news = await run<{ readonly seq: number; readonly events: ReadonlyArray<'open' | 'close' | 'comment'> }>(
        one,
        `globalThis.__altharChip.next(${seq})`,
      ).catch(() => null)
      if (news === null || !live(one, load)) return
      seq = news.seq
      for (const key of news.events) send(one, { kind: 'key', key })
      // Quiet a while: shown again, where the page took it away or covered it, as the window still asks for it.
      if (news.events.length === 0 && one.chip !== null)
        void run(one, `globalThis.__altharChip?.show(${JSON.stringify(one.chip)})`).catch(() => undefined)
    }
  }

  /** Beside a conversation, what a canvas of boards or a page draws in its own view of what it is, or none. */
  const chip = (key: string, asked: Chip | null) => {
    if (asked === null) chips.delete(key)
    else chips.set(key, asked)
    const one = views.get(key)
    if (one === undefined || one.view.webContents.isDestroyed() || JSON.stringify(one.chip) === JSON.stringify(asked)) return
    one.chip = asked
    if (one.target.boards === true)
      void run(one, `globalThis.__altharGround?.set(${JSON.stringify({ chip: asked })})`).catch(() => undefined)
    else if (one.loads > 0) void pageChip(one, one.loads)
  }

  /** Draws the comments' pins on their parts, now and after every load. */
  const pins = (key: string, list: ReadonlyArray<GroundPin>) => {
    const one = boardsView(key)
    if (one === null) return Promise.resolve(null)
    one.pins = list
    return run<ReadonlyArray<number>>(one, `globalThis.__altharGround?.pins(${JSON.stringify(list)}) ?? []`).catch(() => null)
  }

  /** A part found again, brought into view and outlined, with a picture to write its comment over; null where it isn't there. */
  const find = async (key: string, part: { readonly page: string; readonly board: string; readonly selector: string }) => {
    const one = boardsView(key)
    if (one === null) return null
    const loaded = { canvasId: one.target.canvasId, version: one.target.version }
    const found = await run<GroundPart | null>(
      one,
      `globalThis.__altharGround?.find(${JSON.stringify(part.page)}, ${JSON.stringify(part.board)}, ${JSON.stringify(part.selector)}) ?? null`,
    ).catch(() => null)
    return found === null ? null : pictureOf(one, found, loaded)
  }

  /** Takes the outline off what was pointed at: its comment is written, or set aside. */
  const clear = (key: string) => {
    const one = boardsView(key)
    if (one !== null) void run(one, 'globalThis.__altharGround?.clear()').catch(() => undefined)
  }

  const same = (a: CanvasTarget, b: CanvasTarget) =>
    a.projectId === b.projectId &&
    a.canvasId === b.canvasId &&
    a.version === b.version &&
    a.manifest === b.manifest &&
    (a.boards === true) === (b.boards === true)

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
      void one.view.webContents.loadURL(loadAddress(target)).catch(() => undefined)
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
    one.view.setVisible(!covered.has(key))
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

  /** A picture of the canvas as it shows, for the window to show in its place while something of its own is over it. */
  const still = async (key: string): Promise<string | null> => {
    const one = views.get(key)
    if (one === undefined || !one.shown || one.view.webContents.isDestroyed()) return null
    // The compositor can have nothing to give: the window then hides the view with no picture.
    const picture = await one.view.webContents.capturePage().catch(() => null)
    return picture === null || picture.isEmpty() ? null : `data:image/jpeg;base64,${picture.toJPEG(82).toString('base64')}`
  }

  /** Hides the view while something of the window's is over it, and shows it again after. */
  const cover = (key: string, over: boolean) => {
    if (over) covered.add(key)
    else covered.delete(key)
    const one = views.get(key)
    if (one !== undefined) one.view.setVisible(!over)
  }

  /** Loads the shown version again, as it was published: for a canvas that drew itself into a corner. */
  const reload = (key: string) => views.get(key)?.view.webContents.reload()

  const serveDownload = (target: CanvasTarget) => {
    const existing = opened(canvasHost(target.canvasId), target.version, target.projectId)
    if (existing !== null && existing !== target.manifest) throw new Error('The version is already open with other files.')
    const session = sessionOf(target.projectId)
    const held = { ...target }
    downloads.add(held)
    return { session, release: () => void downloads.delete(held) }
  }

  return { show, close, reload, still, cover, opened, change, chip, pins, find, clear, picture, serveDownload }
}

export type Canvases = ReturnType<typeof startCanvases>
