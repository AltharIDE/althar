import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
  type BrowserWindow,
  type Input,
  type NativeImage,
  type Session,
  session as sessions,
  type WebContents,
  WebContentsView,
} from 'electron'

import { signInOf, typedAddress } from './addresses'
import { type CookieKeep, clearsAt, type Moment, type Owner, ownerOf, ownerOfFolder, partitionOf } from './cookies'
import { deviceOf, mobileAgent, placed, type Rect, type Viewport } from './devices'
import { allowed, askedOf, blockedFile, downloadOffered, navigation, popUp, type Verdict } from './guards'
import type { PageKey, PageLine, PageMove, PagePin, PageState, Pointed } from './page'
import { cropOf, type Picked, pickedOf, scaled } from './picked'

/*
 * The pages beside the conversations (ADR-100), as the main process holds
 * them: each a WebContentsView laid over the window where the window keeps
 * its place, in its owner's own session, with no preload, sandboxed and
 * context-isolated, so nothing in it reaches Althar's bridge, the runtime or
 * what Althar keeps. The rules each follows are guards.ts's; this file only
 * hangs them on Electron. What it lays over the window, a native view, sits
 * above the window's page, so the window asks for a picture of it to show
 * in its place while one of its own menus or dialogs is over it.
 *
 * Agents don't drive these pages yet (DEV-83's question, left for later):
 * whatever would, would go through this module's own functions, as the
 * window does, and never reach a page's contents another way.
 */

/** The isolated world the overlay runs in: neither the page's (0) nor Electron's for a preload (999). */
const WORLD = 7_301

/** Pages kept alive while no conversation shows them; the oldest past this is closed, and opens again where it was when next shown. */
const KEPT_HIDDEN = 3

/** The widest a comment's crop is kept, in pixels: a Retina screen's picture of a wide element is drawn smaller. */
const CROP_WIDEST = 1_600

export interface PagesOptions {
  /** The overlay's script (src/overlay), run in each page's isolated world. */
  readonly overlay: () => string
  /** How long pages keep cookies and storage, as the person chose. */
  readonly keep: () => CookieKeep
  /** Where Electron keeps persistent partitions on disk: the user data folder's `Partitions`. */
  readonly partitions: string
  /** Opens a web address in the person's browser. */
  readonly outside: (address: string) => void
  /** Tells every window of Althar's how a page stands, what the person pressed in one, and that one closed of itself (its task done). */
  readonly tell: (state: PageState) => void
  readonly pressed: (owner: string, key: PageKey) => void
  readonly closed: (owner: string) => void
  /** The Chromium the app runs, for a mobile browser's user agent. */
  readonly chrome: string
  /** Electron's own user agent, made Chrome's. */
  readonly agent: string
}

interface Page {
  readonly owner: Owner
  readonly view: WebContentsView
  readonly contents: WebContents
  window: BrowserWindow | null
  /** Where the window keeps the page's place, in its own pixels; null while no conversation shows it. */
  panel: Rect | null
  zoom: number
  viewport: Viewport
  scale: number
  covered: boolean
  pointing: Promise<Pointed | null> | null
  line: PageLine | null
  pins: ReadonlyArray<PagePin>
  hiddenSince: number
  /* What the page is emulated as now: a device at a scale, or nothing; and whether that is a touch screen's. */
  emulating: string | null
  mobile: boolean
  /* Where the page was before the navigation now under way, and where that navigation started: what a sign-in sends out. */
  committed: string
  starting: string | null
  /* Whether pins are drawn on the page now, so a page with none is never touched. */
  pinned: boolean
}

/* Partitions whose rules are set: each session is guarded once, the first time a page of it is made. */
const guarded = new Set<string>()

/**
 * A page's session: no permission but writing what the person copies, no
 * device, no download kept, and Chrome's own user agent. What it refused,
 * the page that asked hears in a line under its bar.
 */
const sessionFor = (owner: Owner, options: PagesOptions, refused: (contents: WebContents, line: PageLine) => void): Session => {
  const partition = partitionOf(owner)
  const made = sessions.fromPartition(partition)
  if (guarded.has(partition)) return made
  guarded.add(partition)
  made.setUserAgent(options.agent)
  made.setPermissionRequestHandler((contents, permission, answer, details) => {
    const allow = allowed(permission)
    answer(allow)
    if (allow) return
    const asked = askedOf(permission, 'mediaTypes' in details ? (details.mediaTypes ?? []) : [])
    if (asked === null) return
    let host = ''
    try {
      host = new URL(details.requestingUrl).host
    } catch {
      host = ''
    }
    refused(contents, { kind: 'asked', asked, host })
  })
  made.setPermissionCheckHandler((_contents, permission) => allowed(permission))
  made.setDevicePermissionHandler(() => false)
  // No device is ever chosen for a page: each chooser is answered with none.
  made.on('select-hid-device', (event, _details, choose) => {
    event.preventDefault()
    choose(null)
  })
  made.on('select-serial-port', (event, _ports, _contents, choose) => {
    event.preventDefault()
    choose('')
  })
  made.on('select-usb-device', (event, _details, choose) => {
    event.preventDefault()
    choose?.()
  })
  made.on('will-download', (event, item, contents) => {
    event.preventDefault()
    const offered = downloadOffered(item.getURL())
    if (contents !== undefined && contents !== null)
      refused(contents, { kind: 'download', name: item.getFilename(), offered: offered !== null })
    downloads.set(contents?.id ?? -1, offered)
  })
  return made
}

/* The last download each page was refused, by its contents' id, for Download in your browser. */
const downloads = new Map<number, string | null>()

const dataUrl = (picture: NativeImage, kind: 'png' | 'jpeg') =>
  kind === 'png'
    ? `data:image/png;base64,${picture.toPNG().toString('base64')}`
    : `data:image/jpeg;base64,${picture.toJPEG(82).toString('base64')}`

const smaller = (picture: NativeImage) => {
  const { width } = picture.getSize()
  return width > CROP_WIDEST ? picture.resize({ width: CROP_WIDEST, quality: 'good' }) : picture
}

const hostOf = (address: string) => {
  try {
    return new URL(address).host
  } catch {
    return ''
  }
}

const mod = (input: Input) => (process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta)

export const startPages = (options: PagesOptions) => {
  const pages = new Map<string, Page>()
  /* How many times a page was hidden, so the one hidden longest is known without a clock. */
  let hidings = 0
  /* What a page closed while hidden was showing, to open it again where it was. */
  const asleep = new Map<string, { readonly address: string; readonly title: string; readonly viewport: Viewport }>()

  const stateOf = (page: Page): PageState => {
    const history = page.contents.navigationHistory
    return {
      owner: page.owner.id,
      address: page.contents.getURL(),
      title: page.contents.getTitle(),
      loading: page.contents.isLoading(),
      back: history.canGoBack(),
      forward: history.canGoForward(),
      viewport: page.viewport,
      pointing: page.pointing !== null,
      line: page.line,
    }
  }
  const tell = (page: Page) => {
    if (!page.contents.isDestroyed()) options.tell(stateOf(page))
  }
  const said = (page: Page, line: PageLine | null) => {
    page.line = line
    tell(page)
  }
  const byContents = (contents: WebContents) => [...pages.values()].find((page) => page.contents === contents)

  const run = <T>(page: Page, code: string): Promise<T> =>
    page.contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], true) as Promise<T>
  /* The overlay, in the page's isolated world: once per document, as each load starts the world afresh. */
  const overlaid = (page: Page) => run<boolean>(page, `${options.overlay()}\n;true`)
  const call = async <T>(page: Page, code: string): Promise<T> => {
    await overlaid(page)
    return run<T>(page, `globalThis.__altharOverlay.${code}`)
  }

  const cdp = async (page: Page, method: string, params: Record<string, unknown> = {}) => {
    const { debugger: debug } = page.contents
    if (!debug.isAttached()) debug.attach('1.3')
    await debug.sendCommand(method, params)
  }

  /** Lays the page out at its viewport's size and draws it at its scale: a device's size with touch and a mobile browser's agent where it is one. */
  const emulate = async (page: Page) => {
    const device = deviceOf(page.viewport)
    const key = device === null ? null : `${page.viewport}:${page.scale.toFixed(4)}`
    if (key === page.emulating) return
    const wasMobile = page.mobile
    page.emulating = key
    page.mobile = device?.mobile === true
    if (device === null) {
      if (!page.contents.debugger.isAttached()) return
      await cdp(page, 'Emulation.clearDeviceMetricsOverride')
      await cdp(page, 'Emulation.setTouchEmulationEnabled', { enabled: false })
      await cdp(page, 'Emulation.setEmitTouchEventsForMouse', { enabled: false })
      await cdp(page, 'Emulation.setUserAgentOverride', { userAgent: options.agent })
      page.contents.debugger.detach()
      if (wasMobile) page.contents.reload()
      return
    }
    await cdp(page, 'Emulation.setDeviceMetricsOverride', {
      width: device.width,
      height: device.height,
      deviceScaleFactor: 0,
      mobile: device.mobile,
      scale: page.scale,
      screenWidth: device.width,
      screenHeight: device.height,
    })
    await cdp(page, 'Emulation.setTouchEmulationEnabled', { enabled: device.mobile, maxTouchPoints: device.mobile ? 5 : 0 })
    await cdp(page, 'Emulation.setEmitTouchEventsForMouse', { enabled: device.mobile && page.pointing === null, configuration: 'mobile' })
    await cdp(page, 'Emulation.setUserAgentOverride', { userAgent: device.mobile ? mobileAgent(options.chrome, device) : options.agent })
    // A site reads the agent as it serves the page: a change between a phone's and a computer's is seen from the next load.
    if (device.mobile !== wasMobile) page.contents.reload()
  }

  /** Puts the view where the window keeps the page's place, at its viewport's size; hidden while something of the window's is over it. */
  const place = (page: Page) => {
    if (page.panel === null || page.window === null) return
    const zoom = page.zoom
    const panel = { x: page.panel.x * zoom, y: page.panel.y * zoom, width: page.panel.width * zoom, height: page.panel.height * zoom }
    const { rect, scale } = placed(panel, page.viewport)
    page.view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })
    page.view.setVisible(!page.covered)
    page.scale = scale
    void emulate(page).catch(() => undefined)
  }

  /** A sign-in sent to the person's browser, opened at what was asked for, where they are signed in already, rather than at its sign-in. */
  const goOutside = (page: Page, verdict: Extract<Verdict, { kind: 'sign-in' }>, address: string) => {
    options.outside(address)
    said(page, { kind: 'sign-in', service: verdict.service })
  }

  /**
   * What a navigation the page starts, or a redirect on its way, is: on,
   * refused where it was, or a sign-in sent out, at the address the
   * navigation set out for, which may have been redirected to its sign-in.
   */
  const guard = (page: Page, event: { preventDefault(): void; readonly url: string; readonly isMainFrame: boolean }, redirect: boolean) => {
    const verdict = navigation(event.url, event.isMainFrame ? 'top' : 'frame')
    if (verdict.kind === 'go') return
    event.preventDefault()
    if (!event.isMainFrame) return
    if (verdict.kind === 'sign-in') return goOutside(page, verdict, redirect ? (page.starting ?? event.url) : event.url)
    said(page, { kind: 'refused', refusal: verdict.refusal })
  }

  const keys = (page: Page, event: { preventDefault(): void }, input: Input) => {
    if (input.type !== 'keyDown') return
    const key = input.key
    if (page.pointing !== null) {
      const act =
        key === 'Escape' ? 'stop()' : key === 'ArrowUp' ? 'widen()' : key === 'ArrowDown' ? 'narrow()' : key === 'Enter' ? 'take()' : null
      if (act !== null) {
        event.preventDefault()
        void call(page, act).catch(() => undefined)
        return
      }
    }
    if (mod(input) && input.shift && key.toLowerCase() === 'c') {
      event.preventDefault()
      return options.pressed(page.owner.id, 'comment')
    }
    if (mod(input) && !input.shift && key.toLowerCase() === 'l') {
      event.preventDefault()
      // The keys go to the window's address field from here on, not the page.
      if (page.window !== null && !page.window.isDestroyed()) page.window.webContents.focus()
      return options.pressed(page.owner.id, 'address')
    }
    if ((mod(input) && !input.shift && key.toLowerCase() === 'r') || key === 'F5') {
      event.preventDefault()
      return page.contents.reload()
    }
    const back = (mod(input) && key === '[') || (input.alt && !input.meta && !input.control && key === 'ArrowLeft')
    const forward = (mod(input) && key === ']') || (input.alt && !input.meta && !input.control && key === 'ArrowRight')
    if (back || forward) {
      event.preventDefault()
      const history = page.contents.navigationHistory
      if (back && history.canGoBack()) history.goBack()
      if (forward && history.canGoForward()) history.goForward()
    }
  }

  const make = (owner: Owner): Page => {
    const session = sessionFor(owner, options, (contents, line) => {
      const page = byContents(contents)
      if (page !== undefined) said(page, line)
    })
    const view = new WebContentsView({
      webPreferences: {
        session,
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
    const contents = view.webContents
    const page: Page = {
      owner,
      view,
      contents,
      window: null,
      panel: null,
      zoom: 1,
      viewport: 'fit',
      scale: 1,
      covered: false,
      pointing: null,
      line: null,
      pins: [],
      hiddenSince: 0,
      emulating: null,
      mobile: false,
      committed: '',
      starting: null,
      pinned: false,
    }
    contents.setWindowOpenHandler(({ url }) => {
      const verdict = popUp(url)
      if (verdict.kind === 'go') void contents.loadURL(url).catch(() => undefined)
      else if (verdict.kind === 'sign-in') goOutside(page, verdict, url)
      else said(page, { kind: 'refused', refusal: verdict.refusal })
      return { action: 'deny' }
    })
    contents.on('will-frame-navigate', (event) => guard(page, event, false))
    contents.on('will-redirect', (event) => guard(page, event, true))
    // A page that sends itself to a sign-in without loading (a single-page app's own router) goes back, and the page it was on goes out.
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      const service = signInOf(url)
      const before = page.committed
      page.committed = url
      if (service === null) return tell(page)
      const history = contents.navigationHistory
      if (history.canGoBack()) history.goBack()
      goOutside(page, { kind: 'sign-in', service }, before === '' ? url : before)
    })
    contents.on('did-start-navigation', (event) => {
      if (!event.isMainFrame || event.isSameDocument) return
      page.starting = event.url
      // A new page clears what was said of the last, and ends pointing at it.
      page.line = null
      page.pinned = false
      if (page.pointing !== null) void call(page, 'stop()').catch(() => undefined)
    })
    contents.on('did-navigate', (_event, url) => {
      page.committed = url
      page.starting = null
      tell(page)
    })
    contents.on('did-start-loading', () => tell(page))
    contents.on('did-stop-loading', () => tell(page))
    contents.on('page-title-updated', () => tell(page))
    contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
      // An aborted load (another started, or stopped) isn't a failure.
      if (!isMainFrame || code === -3) return
      said(page, { kind: 'failed', host: hostOf(url) })
    })
    contents.on('dom-ready', () => {
      void pin(page).catch(() => undefined)
    })
    contents.on('render-process-gone', () => said(page, { kind: 'gone' }))
    contents.on('console-message', (event) => {
      if (event.frame?.parent == null && blockedFile(event.level, event.message)) said(page, { kind: 'refused', refusal: 'file' })
    })
    contents.on('before-input-event', (event, input) => keys(page, event, input))
    contents.on('select-bluetooth-device', (event, _devices, choose) => {
      event.preventDefault()
      choose('')
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    pages.set(owner.id, page)
    return page
  }

  /** Draws the pins of the comments made on the page as it is now. */
  const pin = async (page: Page) => {
    const here = page.contents.getURL()
    const shown = page.pins.filter((one) => one.address === here).map(({ n, selector }) => ({ n, selector }))
    if (shown.length === 0 && !page.pinned) return
    page.pinned = shown.length > 0
    await call(page, `pins(${JSON.stringify(shown)})`)
  }

  /** Takes the view off its window, where that window is still there to take it from. */
  const detach = (page: Page) => {
    if (page.window !== null && !page.window.isDestroyed()) page.window.contentView.removeChildView(page.view)
    page.window = null
  }

  /** Hides a page no conversation shows now: it stays, where it was, until it is shown again or put to sleep. */
  const hide = (page: Page) => {
    detach(page)
    page.panel = null
    page.covered = false
    hidings += 1
    page.hiddenSince = hidings
  }

  const close = (page: Page) => {
    pages.delete(page.owner.id)
    detach(page)
    downloads.delete(page.contents.id)
    if (!page.contents.isDestroyed()) page.contents.close()
  }

  /**
   * Closes the pages hidden longest, past the few kept, remembering where
   * each was. Asleep, a page isn't closed for the person: it opens again
   * where it was, its session as it was, so nothing it kept is cleared.
   */
  const sleep = () => {
    const hidden = [...pages.values()].filter((page) => page.panel === null).sort((a, b) => a.hiddenSince - b.hiddenSince)
    for (const page of hidden.slice(0, Math.max(0, hidden.length - KEPT_HIDDEN))) {
      asleep.set(page.owner.id, { address: page.contents.getURL(), title: page.contents.getTitle(), viewport: page.viewport })
      close(page)
    }
  }

  /**
   * A session's cookies, storage and cache gone: cleared where Electron has
   * the session open this launch, else its folder removed whole, which
   * leaves nothing Chromium keeps besides.
   */
  const clearSession = async (owner: Owner) => {
    const partition = partitionOf(owner)
    if (!guarded.has(partition)) {
      await rm(join(options.partitions, partition.slice('persist:'.length)), { recursive: true, force: true }).catch(() => undefined)
      return
    }
    const session = sessions.fromPartition(partition)
    await Promise.all([session.clearStorageData(), session.clearCache(), session.clearAuthCache()])
  }

  /** The page an owner has, made where it has none, or woken where it was closed while hidden. */
  const pageOf = (owner: Owner) => {
    const found = pages.get(owner.id)
    if (found !== undefined) return found
    const made = make(owner)
    const woke = asleep.get(owner.id)
    asleep.delete(owner.id)
    if (woke !== undefined) {
      made.viewport = woke.viewport
      if (woke.address !== '') void made.contents.loadURL(woke.address).catch(() => undefined)
    }
    return made
  }

  const pictureOf = async (page: Page, picked: Picked): Promise<Pointed> => {
    const crop = cropOf(picked.rect, picked.page)
    // A picture the compositor can't give leaves the comment without its crop, never without the comment.
    const [still, cropped] = await Promise.all([
      page.contents.capturePage().catch(() => null),
      crop === null ? Promise.resolve(null) : page.contents.capturePage(scaled(crop, page.scale)).catch(() => null),
    ])
    const shown = cropped === null || cropped.isEmpty() ? null : smaller(cropped)
    const at = scaled(picked.rect, page.scale)
    const zoom = page.zoom
    return {
      picked,
      crop: shown === null ? null : dataUrl(shown, 'png'),
      cropSize: shown === null ? null : shown.getSize(),
      still: still === null || still.isEmpty() ? '' : dataUrl(still, 'jpeg'),
      scale: page.scale,
      at: { x: at.x / zoom, y: at.y / zoom, width: at.width / zoom, height: at.height / zoom },
      address: page.contents.getURL(),
      viewport: page.viewport,
    }
  }

  const live = (owner: string) => {
    const page = pages.get(owner)
    return page === undefined || page.contents.isDestroyed() ? null : page
  }

  return {
    /** Opens an address beside an owner's conversation: typed, a link, or a run's. Says why not where it isn't a web page. */
    open: (ownerId: string, address: string): PageState | null => {
      const owner = ownerOf(ownerId)
      if (owner === null) return null
      const page = pageOf(owner)
      const typed = typedAddress(address)
      if (typed === null) {
        said(page, { kind: 'refused', refusal: 'address' })
        return stateOf(page)
      }
      const verdict = navigation(typed)
      if (verdict.kind === 'refuse') said(page, { kind: 'refused', refusal: verdict.refusal })
      else if (verdict.kind === 'sign-in') goOutside(page, verdict, typed)
      else {
        page.line = null
        void page.contents.loadURL(typed).catch(() => undefined)
      }
      return stateOf(page)
    },
    /**
     * How each page open stands, for a window opened or reloaded after them,
     * which hasn't heard: one asleep as it will wake, where it was, without
     * its history.
     */
    states: (): ReadonlyArray<PageState> => [
      ...[...pages.values()].flatMap((page) => (page.contents.isDestroyed() ? [] : [stateOf(page)])),
      ...[...asleep].map(([owner, kept]): PageState => ({
        owner,
        address: kept.address,
        title: kept.title,
        loading: false,
        back: false,
        forward: false,
        viewport: kept.viewport,
        pointing: false,
        line: null,
      })),
    ],
    /** Lays the page over the window where it keeps its place, or takes it off while no conversation shows it. */
    show: (window: BrowserWindow, ownerId: string, panel: Rect | null) => {
      const owner = ownerOf(ownerId)
      if (owner === null) return
      if (panel === null) {
        const page = live(ownerId)
        if (page === null || page.panel === null) return
        hide(page)
        return sleep()
      }
      const page = pageOf(owner)
      if (page.window !== window) {
        detach(page)
        window.contentView.addChildView(page.view)
        page.window = window
      }
      page.panel = panel
      page.zoom = window.webContents.getZoomFactor()
      place(page)
    },
    move: (ownerId: string, move: PageMove) => {
      const page = live(ownerId)
      if (page === null) return
      const history = page.contents.navigationHistory
      if (move === 'back' && history.canGoBack()) history.goBack()
      if (move === 'forward' && history.canGoForward()) history.goForward()
      if (move === 'reload') page.contents.reload()
      if (move === 'stop') page.contents.stop()
      if (page.line?.kind === 'failed' || page.line?.kind === 'gone') said(page, null)
    },
    viewport: (ownerId: string, viewport: Viewport) => {
      const page = live(ownerId)
      if (page === null) return
      page.viewport = viewport
      place(page)
      tell(page)
    },
    /** Points at the page: the element the person presses, its crop and a picture of the page; null where they stopped. */
    point: (ownerId: string): Promise<Pointed | null> => {
      const page = live(ownerId)
      if (page === null || page.panel === null) return Promise.resolve(null)
      if (page.pointing !== null) return page.pointing
      const pointing = (async () => {
        if (deviceOf(page.viewport)?.mobile === true) await cdp(page, 'Emulation.setEmitTouchEventsForMouse', { enabled: false })
        page.contents.focus()
        const picked = pickedOf(await call<unknown>(page, 'point()').catch(() => null))
        return picked === null ? null : pictureOf(page, picked)
      })()
      page.pointing = pointing
      tell(page)
      void pointing
        .finally(() => {
          page.pointing = null
          if (page.contents.isDestroyed()) return
          tell(page)
          if (deviceOf(page.viewport)?.mobile === true)
            void cdp(page, 'Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }).catch(() => undefined)
        })
        .catch(() => undefined)
      return pointing.catch(() => null)
    },
    stopPointing: (ownerId: string) => {
      const page = live(ownerId)
      if (page?.pointing != null) void call(page, 'stop()').catch(() => undefined)
    },
    /** The comments' pins, drawn on the page each was made on whenever it shows. */
    pins: (ownerId: string, pins: ReadonlyArray<PagePin>) => {
      const page = live(ownerId)
      if (page === null) return
      page.pins = pins
      void pin(page).catch(() => undefined)
    },
    /** An element found again, brought into view, with a picture of the page to write over: going back to its page first where it is elsewhere. */
    find: async (ownerId: string, selector: string, address: string): Promise<Pointed | null> => {
      const page = live(ownerId)
      if (page === null || page.panel === null) return null
      if (page.contents.getURL() !== address && navigation(address).kind === 'go')
        await page.contents.loadURL(address).catch(() => undefined)
      const found = pickedOf(await call<unknown>(page, `find(${JSON.stringify(selector)})`).catch(() => null))
      return found === null ? null : pictureOf(page, found)
    },
    /** A picture of the page as it shows, for the window to show in its place while something of its own is over it. */
    still: async (ownerId: string): Promise<string | null> => {
      const page = live(ownerId)
      if (page === null || page.panel === null) return null
      // The compositor can have nothing to give (a view just laid out, a window drawn clear): the window then hides the page with no picture.
      const picture = await page.contents.capturePage().catch(() => null)
      return picture === null || picture.isEmpty() ? null : dataUrl(picture, 'jpeg')
    },
    /**
     * A window closed, or its document went (reloaded as the runtime
     * restarts): nothing there will say where the pages it showed go now, so
     * they are hidden, to show again where a window asks for them.
     */
    hideIn: (window: BrowserWindow) => {
      for (const page of pages.values()) if (page.window === window) hide(page)
      sleep()
    },
    /** Hides the view while something of the window's is over it, and shows it again after. */
    cover: (ownerId: string, covered: boolean) => {
      const page = live(ownerId)
      if (page === null) return
      page.covered = covered
      page.view.setVisible(!covered && page.panel !== null)
    },
    /** The page's address in the person's browser; with a refused download, the download's. */
    outside: (ownerId: string, what: 'page' | 'download') => {
      const page = live(ownerId)
      if (page === null) return
      const address = what === 'download' ? (downloads.get(page.contents.id) ?? null) : page.contents.getURL()
      if (address !== null && navigation(address).kind !== 'refuse') options.outside(address)
      if (what === 'download') said(page, null)
    },
    dismiss: (ownerId: string) => {
      const page = live(ownerId)
      if (page !== null) said(page, null)
    },
    /** Closes an owner's page; its cookies and storage go where the person keeps them only until it closes. */
    close: async (ownerId: string) => {
      const owner = ownerOf(ownerId)
      if (owner === null) return
      asleep.delete(ownerId)
      const page = live(ownerId)
      if (page !== null) close(page)
      if (clearsAt(options.keep(), 'closed')) await clearSession(owner)
    },
    /** One owner's cookies and storage, at the person's word. */
    clear: async (ownerId: string) => {
      const owner = ownerOf(ownerId)
      if (owner === null) return
      await clearSession(owner)
      live(ownerId)?.contents.reload()
    },
    /** Every page's cookies and storage, at the person's word (Settings › Browser). */
    clearAll: async () => {
      const owners = new Map<string, Owner>()
      for (const page of pages.values()) owners.set(page.owner.id, page.owner)
      for (const owner of await ownersOnDisk(options.partitions)) owners.set(owner.id, owner)
      await Promise.all([...owners.values()].map(clearSession))
      for (const page of pages.values()) page.contents.reload()
    },
    /**
     * At a moment that may end what pages kept: their tasks settled, Althar
     * quitting or starting. A settled task's page closes first, and the
     * windows hear it closed; one that can't close leaves the others to clear.
     */
    moment: async (moment: Moment, settled: ReadonlyArray<string> = []) => {
      if (!clearsAt(options.keep(), moment)) return
      const owners = moment === 'settled' ? settled.flatMap((id) => ownerOf(id) ?? []) : await ownersOnDisk(options.partitions)
      if (moment === 'settled')
        for (const owner of owners) {
          const page = pages.get(owner.id)
          const slept = asleep.delete(owner.id)
          if (page === undefined && !slept) continue
          try {
            if (page !== undefined) close(page)
          } catch {
            // Gone from the pages all the same: the window hears it closed, and every owner's session is still cleared.
          }
          options.closed(owner.id)
        }
      await Promise.allSettled(owners.map(clearSession))
    },
    /** Whether web contents are a page's, which is no window of Althar's own. */
    has: (contents: WebContents) => byContents(contents) !== undefined,
  }
}

export type Pages = ReturnType<typeof startPages>

/** The owners whose pages kept anything on disk, by their partitions' folders. */
export const ownersOnDisk = async (partitions: string): Promise<ReadonlyArray<Owner>> => {
  const folders = await readdir(partitions).catch(() => [] as Array<string>)
  return folders.flatMap((folder) => ownerOfFolder(folder) ?? [])
}

/** Where Electron keeps persistent partitions for a user data folder. */
export const partitionsIn = (userData: string) => join(userData, 'Partitions')
