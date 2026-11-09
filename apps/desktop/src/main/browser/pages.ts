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

import type { PageCall, PageDone, PageTarget } from '@althar/runtime/pageBridge'

import { signInOf, typedAddress } from './addresses'
import { type CookieKeep, clearsAt, type Moment, type Owner, ownerOf, ownerOfFolder, partitionOf } from './cookies'
import { deviceOf, mobileAgent, placed, type Rect, type Viewport } from './devices'
import {
  acted,
  answeredWords,
  answerOf,
  chosenOf,
  chordOf,
  coveredWords,
  dialogOf,
  dialogWords,
  doneOf,
  filledOf,
  type Hand,
  inputOf,
  keydowns,
  type KeyStroke,
  keyEvents,
  layoutOf,
  lineWords,
  locatedOf,
  logsOf,
  logWords,
  movedWords,
  named_,
  PACE,
  type Pace,
  pageHeader,
  type PageDialog,
  type PageFacts,
  personUsed,
  type Place,
  placeWords,
  pngSize,
  readLogs,
  refusalWords,
  scrolledOf,
  scrolledWords,
  signInWords,
  snapshotOf,
  snapshotWords,
  SNAPSHOT_LIMIT,
  stateWords,
  TALLEST,
  targetWords,
  troubleSince,
  viewportWords,
  type Whose,
  words,
  WORLD_EVAL,
} from './drive'
import type { Found } from './driving'
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
 * The lead and the coordinator read and drive the page beside their own
 * conversation without asking (ADR-100, agents driving pages). They do it
 * through this module's own `drive`, as the window does through the others,
 * and nothing reaches a page's contents another way: not a window, not a
 * page, not the agent. The runtime's tools reach `drive` through the
 * bridge (bridge.ts), whose only caller is the runtime's own process. A
 * navigation an agent starts or causes meets the same guards as the person's;
 * its input is real input, which the person's own always beats (drive.ts).
 */

/** The isolated world the overlay runs in: neither the page's (0) nor Electron's for a preload (999). */
const WORLD = 7_301

/** The longest one call into a page or its debugger is waited for before the lead hears it didn't answer. */
const ANSWER_MS = 15_000

/** Waits for the page to draw twice more, or a moment where it draws nothing (a page out of sight isn't drawn). */
const REPAINTED =
  'new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(() => done(true))); setTimeout(() => done(true), 150) })'

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
  /** Tells every window that a page an agent opened or woke has no place yet, so they place it beside its conversation. */
  readonly opened: (owner: string) => void
  /** How many windows of Althar's are open: an agent's tools need one to put a page beside a conversation. */
  readonly windows: () => number
  /** Whether Althar is quitting. */
  readonly quitting: () => boolean
  /** How long things take for an agent driving a page: a test sets its own. */
  readonly pace?: Pace
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
  /* Where the window last said it shows the page; null while no conversation shows it. */
  where: 'beside' | 'tab' | null
  /* An agent is acting on the page now, or did a moment ago; the timer that ends it. */
  working: boolean
  workTimer: ReturnType<typeof setTimeout> | null
  /* What the page said to its console and which of its requests failed, for the agent's page_logs. */
  readonly logs: ReturnType<typeof logsOf>
  /* Whether an agent has used the page's debugger, which then stays attached for it. */
  driving: boolean
  /* What an agent asked of the page, one at a time. */
  queue: Promise<unknown>
  /* How many of an agent's calls are under way or wait their turn: a page with any isn't put to sleep. */
  calls: number
  /* How many times the person's input stopped an agent's action: a call that waited its turn behind one isn't done. */
  yields: number
  /* What the call under way came with, which ends where the runtime gave up on it. */
  signal: AbortSignal | null
  /*
   * Which document the page shows, counted as each loads; and the one the agent's last snapshot, with its refs, was of:
   * null before any, -1 for refs of a document gone (a page that slept and woke, one that loaded as it was read).
   */
  document: number
  refsDocument: number | null
  /* A dialog the page opened, which holds everything in it until it is answered; seen while the debugger is attached for an agent. */
  dialog: PageDialog | null
  /* What waits on an agent's call into the page, which a dialog stops: the page answers nothing until it is answered. */
  readonly dialogWaiters: Set<() => void>
  /* Whether the debugger tells of the page's dialogs now. */
  watching: boolean
  /* The page asked to stay (its beforeunload) as an agent's action left it, and was left all the same. */
  leftUnsaved: boolean
}

/** A dialog the page opened while an agent's call waited on it: the call goes no further, and the agent hears why. */
class DialogOpen extends Error {}

/* Partitions whose rules are set: each session is guarded once, the first time a page of it is made. */
const guarded = new Set<string>()

/**
 * A page's session: no permission but writing what the person copies, no
 * device, no download kept, and Chrome's own user agent. What it refused,
 * the page that asked hears in a line under its bar.
 */
const sessionFor = (
  owner: Owner,
  options: PagesOptions,
  refused: (contents: WebContents, line: PageLine) => void,
  failed: (webContentsId: number | undefined, text: string) => void,
): Session => {
  const partition = partitionOf(owner)
  const made = sessions.fromPartition(partition)
  if (guarded.has(partition)) return made
  guarded.add(partition)
  made.setUserAgent(options.agent)
  // What fails to load is the lead's to read (page_logs): a request that ended in an error, or in a status of 400 or more. A load someone cancelled isn't a failure.
  made.webRequest.onErrorOccurred((details) => {
    if (details.error === 'net::ERR_ABORTED') return
    failed(details.webContentsId, `${details.method} ${details.url} failed: ${details.error}`)
  })
  made.webRequest.onCompleted((details) => {
    if (details.statusCode < 400) return
    const status = details.statusLine.replace(/^HTTP\/[\d.]+\s*/, '').trim()
    failed(details.webContentsId, `${details.method} ${details.url} answered ${status === '' ? details.statusCode : status}`)
  })
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

/** The size a page has before a conversation shows it, and while none does: what a laptop's page is. */
const UNSEEN = { width: 1_280, height: 800 }

/** Where a console message came from, as a line of a file: ` (app.js:12)`; nothing for a message with no place. */
const sourceWords = (source: string, line: number): string => {
  const file =
    source
      .split(/[?#]/)[0]
      ?.split('/')
      .filter((part) => part !== '')
      .at(-1) ?? ''
  return file === '' || source.startsWith('about:') ? '' : ` (${file}${line > 0 ? `:${line}` : ''})`
}

const mod = (input: Input) => (process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta)

export const startPages = (options: PagesOptions) => {
  const pages = new Map<string, Page>()
  /* How many times a page was hidden, so the one hidden longest is known without a clock. */
  let hidings = 0
  /* What a page closed while hidden was showing, to open it again where it was. */
  const asleep = new Map<string, { readonly address: string; readonly title: string; readonly viewport: Viewport; readonly mark: number }>()

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
      working: page.working,
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

  // Without a user gesture: Althar reading the page, or drawing on it, gives its scripts no activation to open pop-ups or play sound with.
  const run = <T>(page: Page, code: string): Promise<T> =>
    page.contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], false) as Promise<T>
  /* The overlay, in the page's isolated world: once per document, as each load starts the world afresh. */
  const overlaid = (page: Page) => run<boolean>(page, `${options.overlay()}\n;true`)
  const call = async <T>(page: Page, code: string): Promise<T> => {
    await overlaid(page)
    return run<T>(page, `globalThis.__altharOverlay.${code}`)
  }

  const cdp = async <T = unknown>(page: Page, method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const { debugger: debug } = page.contents
    if (!debug.isAttached()) debug.attach('1.3')
    return (await debug.sendCommand(method, params)) as T
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
      // An agent that drives the page by its debugger keeps it, with the emulation cleared.
      if (!page.driving) page.contents.debugger.detach()
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

  /**
   * A page no conversation shows lays out at its viewport's own size, whole
   * (a laptop's for the panel's own), so an agent can read it and take its
   * picture; shown again, it is placed as the window says.
   */
  const unseen = (page: Page) => {
    const device = deviceOf(page.viewport)
    const size = device ?? UNSEEN
    page.view.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    page.scale = 1
    void emulate(page).catch(() => undefined)
  }

  /** Puts the view where the window keeps the page's place, at its viewport's size; hidden while something of the window's is over it. */
  const place = (page: Page) => {
    if (page.panel === null || page.window === null) return unseen(page)
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

  const make = (owner: Owner, logFrom = 0): Page => {
    const session = sessionFor(
      owner,
      options,
      (contents, line) => {
        const page = byContents(contents)
        if (page !== undefined) said(page, line)
      },
      (id, text) => {
        // A session is one owner's alone, so a request nobody owns (a worker's) is still its page's.
        const page = [...pages.values()].find((one) => !one.contents.isDestroyed() && one.contents.id === id) ?? pages.get(owner.id)
        page?.logs.add('network', 'error', text)
      },
    )
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
    // A page no conversation shows yet still lays out at a size, so an agent can read it and take its picture.
    view.setBounds({ x: 0, y: 0, width: UNSEEN.width, height: UNSEEN.height })
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
      where: null,
      working: false,
      workTimer: null,
      logs: logsOf(500, logFrom),
      driving: false,
      queue: Promise.resolve(),
      calls: 0,
      yields: 0,
      signal: null,
      document: 0,
      refsDocument: null,
      dialog: null,
      dialogWaiters: new Set(),
      watching: false,
      leftUnsaved: false,
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
      // A new document: the refs of a snapshot of the last name nothing in it.
      page.document += 1
      tell(page)
    })
    // A page that asks to stay as an agent's action leaves it is left, and the agent hears it; the person's own leaving is the page's to stop.
    contents.on('will-prevent-unload', (event) => {
      if (!page.working) return
      event.preventDefault()
      page.leftUnsaved = true
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
      page.logs.add('console', event.level, `${event.message}${sourceWords(event.sourceId, event.lineNumber)}`)
    })
    // The debugger an agent drives by goes when the page's process does, taking the emulation with it.
    contents.debugger.on('detach', () => {
      page.emulating = null
      page.driving = false
      page.watching = false
      page.dialog = null
    })
    // A dialog holds the page until it is answered: what waits on the page hears it at once, rather than when it gives up.
    contents.debugger.on('message', (_event, method, params) => {
      if (method === 'Page.javascriptDialogClosed') {
        page.dialog = null
        void relax(page)
      }
      if (method !== 'Page.javascriptDialogOpening') return
      const dialog = dialogOf(params)
      if (dialog === null) return
      page.dialog = dialog
      for (const wake of page.dialogWaiters) wake()
      page.dialogWaiters.clear()
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
    page.where = null
    page.covered = false
    hidings += 1
    page.hiddenSince = hidings
    unseen(page)
  }

  const close = (page: Page) => {
    pages.delete(page.owner.id)
    if (page.workTimer !== null) clearTimeout(page.workTimer)
    page.workTimer = null
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
    // A page an agent is at work on stays awake, whatever is hidden.
    const hidden = [...pages.values()]
      .filter((page) => page.panel === null && page.calls === 0)
      .sort((a, b) => a.hiddenSince - b.hiddenSince)
    for (const page of hidden.slice(0, Math.max(0, hidden.length - KEPT_HIDDEN))) {
      asleep.set(page.owner.id, {
        address: page.contents.getURL(),
        title: page.contents.getTitle(),
        viewport: page.viewport,
        mark: page.logs.mark(),
      })
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
    if (found !== undefined && !found.contents.isDestroyed()) return found
    const woke = asleep.get(owner.id)
    const made = make(owner, woke?.mark ?? 0)
    asleep.delete(owner.id)
    if (woke !== undefined) {
      // The refs the agent holds are of the page as it was before it slept.
      made.refsDocument = -1
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

  // ─── An agent at the page ──────────────────────────────────────────────
  // The lead and the coordinator read and drive the page beside their own conversation (ADR-100). Everything of
  // theirs goes through `drive`, below: the guards on the page's contents are the ones the person meets, and input
  // is real input, which the person's own always beats.

  const pace = options.pace ?? PACE
  const mac = process.platform === 'darwin'

  const pause = (ms: number) => new Promise<void>((resolve) => void setTimeout(resolve, ms))

  /**
   * What one call into the page or its debugger gives, or a failure in words where it doesn't answer in time: a page
   * busy in a loop, or an input the page never acknowledges, never holds the lead (or the calls queued behind it) up.
   */
  const answered = <T>(work: Promise<T>, what: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`it didn’t answer ${what} within ${Math.round(ANSWER_MS / 1000)} seconds`)),
        ANSWER_MS,
      )
      work.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })

  /** What a promise gives, or undefined where it took longer than `ms`. */
  const within = <T>(work: Promise<T>, ms: number): Promise<T | undefined> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(undefined), ms)
      work.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })

  /**
   * What a call into the page gives, unless the page opens a dialog first: a dialog holds everything in the page until
   * it is answered, so the call stops there, and the agent hears what the dialog says rather than that nothing answered.
   */
  const heldBy = <T>(page: Page, work: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      if (page.dialog !== null) {
        work.catch(() => undefined)
        return reject(new DialogOpen())
      }
      const wake = () => reject(new DialogOpen())
      page.dialogWaiters.add(wake)
      work.then(
        (value) => {
          page.dialogWaiters.delete(wake)
          resolve(value)
        },
        (error: unknown) => {
          page.dialogWaiters.delete(wake)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })

  /** Waits for the page to stop loading, up to `ms`; whether it did. */
  const settled = (page: Page, ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (page.contents.isDestroyed() || !page.contents.isLoading()) return resolve(true)
      const finish = (ok: boolean) => {
        clearTimeout(timer)
        page.contents.removeListener('did-stop-loading', stop)
        resolve(ok)
      }
      const stop = () => finish(true)
      const timer = setTimeout(() => finish(false), ms)
      page.contents.on('did-stop-loading', stop)
    })

  /** The page says an agent is at work on it, until its last action has been over a moment, or at once where the person's input made it stop. */
  const busy = (page: Page) => {
    if (page.workTimer !== null) clearTimeout(page.workTimer)
    page.workTimer = null
    if (page.working) return
    page.working = true
    tell(page)
  }
  const fade = (page: Page) => {
    if (page.workTimer !== null) clearTimeout(page.workTimer)
    page.workTimer = setTimeout(() => {
      page.workTimer = null
      page.working = false
      tell(page)
    }, pace.fade)
  }
  const stood = (page: Page) => {
    if (page.workTimer !== null) clearTimeout(page.workTimer)
    page.workTimer = null
    if (!page.working) return
    page.working = false
    tell(page)
  }

  /** The ref a call names its element by, where it names one so. */
  const refIn = (call: PageCall): string | null =>
    'target' in call && call.target !== null && call.target.ref !== undefined ? call.target.ref : null

  /**
   * Why a call can't go on the page now, or null where it can: the person pointing at it, a dialog it holds for, a ref
   * from a document it no longer shows. Asked as a call is made, and again as its turn comes.
   */
  const heldUp = (page: Page, call: PageCall): string | null => {
    if (page.pointing !== null && call.op !== 'snapshot' && call.op !== 'screenshot' && call.op !== 'wait') return words.pointing
    if (page.dialog !== null && call.op !== 'dialog') return dialogWords(page.dialog)
    const ref = refIn(call)
    if (ref !== null && page.refsDocument !== null && page.refsDocument !== page.document) return words.staleRef(ref)
    return null
  }

  /**
   * What an agent asks of a page goes one at a time: two calls made together would press over each other. A call whose
   * turn comes once the runtime gave up on it isn't done, nor one queued behind an action the person's input stopped.
   */
  const alone = (page: Page, call: PageCall, signal: AbortSignal | null, work: () => Promise<PageDone>): Promise<PageDone> => {
    const yields = page.yields
    page.calls += 1
    const turn = async (): Promise<PageDone> => {
      if (signal?.aborted === true) return { error: words.gaveUp }
      if (page.yields !== yields) return { error: words.yieldedQueued }
      const held = page.contents.isDestroyed() ? null : heldUp(page, call)
      if (held !== null) return { error: held }
      page.signal = signal
      try {
        return await work()
      } finally {
        page.signal = null
      }
    }
    const next = page.queue.then(turn, turn).finally(() => {
      page.calls -= 1
    })
    page.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** The in-page driver (src/overlay/driver.ts), in the page's isolated world: asked for something, answers with plain data to be read as untrusted. */
  const ask = (page: Page, method: string, ...args: ReadonlyArray<unknown>): Promise<unknown> =>
    answered(
      heldBy(
        page,
        overlaid(page).then(() =>
          run<unknown>(page, `globalThis.__altharDriver.${method}(${args.map((one) => JSON.stringify(one ?? null)).join(', ')})`),
        ),
      ),
      'Althar’s reading of it',
    )
  /** Real input through the debugger, as Chromium takes a device's. */
  const input = (page: Page, method: string, params: Record<string, unknown>) =>
    answered(heldBy(page, cdp(page, method, params)), 'the input sent to it')
  const targetOf = (target: PageTarget) => ({
    ...(target.ref === undefined ? {} : { ref: target.ref }),
    ...(target.selector === undefined ? {} : { selector: target.selector }),
  })
  const finding = async (page: Page, target: PageTarget, scroll: boolean): Promise<Found | string> => {
    const located = locatedOf(await ask(page, 'locate', targetOf(target), scroll))
    if (located === null) return words.unreadable
    return located.ok ? located : located.why
  }
  /** How many presses, keys and wheel turns from a real device the page has had; null where it can't say. */
  const inputNow = (page: Page) => ask(page, 'input').then(inputOf, () => null)
  const outline = (page: Page, rect: Picked['rect']) => void ask(page, 'mark', rect).catch(() => undefined)
  /** Whether the page has what is asked for; null where it didn't answer within `ms`, which is neither. */
  const holds = async (page: Page, query: { text?: string; selector?: string; ref?: string }, ms: number): Promise<boolean | null> =>
    within(ask(page, 'has', query), ms).then(
      (found) => (found === undefined ? null : found === true),
      () => null,
    )

  /** The debugger an agent drives by stays attached for it, with the emulation (`emulate`) cleared when the viewport is the panel's own. */
  const debugging = (page: Page) => {
    page.driving = true
  }
  /** The debugger attached for an agent, telling of the page's dialogs, which hold it until answered. */
  const watch = async (page: Page) => {
    debugging(page)
    if (page.watching) return
    await answered(cdp(page, 'Page.enable'), 'for its dialogs').then(
      () => {
        page.watching = true
      },
      () => undefined,
    )
  }
  /**
   * Gives the page back its focus, and a touch screen its mouse, once the dialog it was held on is answered. The
   * action that opened the dialog leaves these be (a call sent to a page a dialog holds can close it), so the close
   * does it.
   */
  const relax = async (page: Page) => {
    if (!page.driving || page.contents.isDestroyed()) return
    await cdp(page, 'Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined)
    if (page.mobile && page.pointing === null)
      await cdp(page, 'Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }).catch(() => undefined)
  }
  /** Where the page takes a point in the viewport's CSS pixels, for input: the page is drawn `scale` times its size in a smaller viewport. (The e2e checks this under a phone's viewport.) */
  const viewPoint = (page: Page, at: { readonly x: number; readonly y: number }) => ({ x: at.x * page.scale, y: at.y * page.scale })
  const BUTTONS = { left: 1, right: 2, middle: 4 } as const
  const mouse = (
    page: Page,
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
    point: { readonly x: number; readonly y: number },
    button: 'none' | 'left' | 'right' | 'middle',
    clickCount: number,
  ) =>
    input(page, 'Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button,
      buttons: type === 'mousePressed' && button !== 'none' ? BUTTONS[button] : 0,
      clickCount,
      pointerType: 'mouse',
    })
  const strike = async (page: Page, strokes: ReadonlyArray<KeyStroke>) => {
    for (const event of keyEvents(strokes, mac)) await input(page, 'Input.dispatchKeyEvent', event as Record<string, unknown>)
  }

  /** What an action starts from: how many real inputs the page had, where it was, what its line said, and where its log stood. */
  interface Run {
    readonly hand: Hand
    readonly address: string
    readonly line: PageLine | null
    readonly mark: number
  }

  /**
   * An action on the page: it shows the lead at work, gives the page focus
   * the way a person's click would (emulated, so Althar's own window keeps
   * the keyboard), and counts what the page takes from a real device against
   * what the action sends, so the person's own input is told from it.
   */
  const doing = async (page: Page, body: (run: Run) => Promise<PageDone>): Promise<PageDone> => {
    busy(page)
    debugging(page)
    page.leftUnsaved = false
    // A dialog holds the page: a call sent to it now waits, and can close the dialog rather than its own answer.
    const emulation = async (method: string, params: Record<string, unknown>, what: string) => {
      if (page.dialog !== null) return
      await answered(heldBy(page, cdp(page, method, params)), what).catch(() => undefined)
    }
    await emulation('Emulation.setFocusEmulationEnabled', { enabled: true }, 'for its focus')
    // On a touch screen's viewport the person's mouse is made a finger; the lead's presses go in as they are, as pointing's do.
    const touch = page.mobile
    if (touch) await emulation('Emulation.setEmitTouchEventsForMouse', { enabled: false }, 'for its touch')
    try {
      const baseline = (await inputNow(page)) ?? 0
      return await body({ hand: { baseline, injected: 0 }, address: page.contents.getURL(), line: page.line, mark: page.logs.mark() })
    } catch (error) {
      // The action opened a dialog (a confirm on Delete, an alert on submit): it went as far as that, and the lead hears what the dialog asks.
      if (error instanceof DialogOpen && page.dialog !== null) return { value: { text: dialogWords(page.dialog, true) } }
      throw error
    } finally {
      await emulation('Emulation.setFocusEmulationEnabled', { enabled: false }, 'for its focus')
      if (touch && page.mobile && page.pointing === null)
        await emulation('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }, 'for its touch')
      if (page.working) fade(page)
    }
  }

  /**
   * The person used the page since this action began, or started pointing at it to comment: it stops there, the page
   * stops saying the lead is at work, and what waited its turn behind it isn't done either. It stops too where the
   * runtime gave up on the call.
   */
  const yielded = async (page: Page, run: Run, done: string): Promise<PageDone | null> => {
    if (page.signal?.aborted === true) {
      stood(page)
      return { error: words.gaveUp }
    }
    if (page.pointing === null && !personUsed(run.hand, await inputNow(page))) return null
    page.yields += 1
    stood(page)
    return { error: page.pointing === null ? words.yielded(done) : words.pointing }
  }

  /** What an action set going, once it has had a moment: a page that went on, what the guards did, what went wrong in the page, a dialog it opened. */
  const aftermath = async (page: Page, run: Run): Promise<ReadonlyArray<string>> => {
    await pause(pace.settle)
    if (page.contents.isLoading()) await settled(page, pace.load)
    return [
      movedWords(run.address, { address: page.contents.getURL(), title: page.contents.getTitle() }),
      page.leftUnsaved ? words.leftUnsaved : '',
      (page.line === run.line ? null : lineWords(page.line)) ?? '',
      troubleSince(page.logs, run.mark),
      page.dialog === null ? '' : dialogWords(page.dialog, true),
    ]
  }

  const shownOf = (address: string, title: string) => `${address === '' ? 'a blank page' : address}${title === '' ? '' : ` (“${title}”)`}`

  const placeOf = (page: Page): Place => (page.panel === null ? 'waiting' : page.where === 'tab' ? 'tab' : 'beside')

  const factsOf = (owner: Owner): PageFacts => {
    const base = { whose: owner.kind as Whose, window: options.windows() > 0 }
    const page = live(owner.id)
    if (page !== null) {
      const state = stateOf(page)
      return {
        ...base,
        open: true,
        address: state.address,
        title: state.title,
        viewport: state.viewport,
        place: placeOf(page),
        loading: state.loading,
        back: state.back,
        forward: state.forward,
        line: state.line,
        mark: page.logs.mark(),
        dialog: page.dialog,
      }
    }
    const kept = asleep.get(owner.id)
    const none = { loading: false, back: false, forward: false, line: null, mark: 0, dialog: null }
    if (kept !== undefined)
      return {
        ...base,
        ...none,
        open: true,
        address: kept.address,
        title: kept.title,
        viewport: kept.viewport,
        place: 'asleep',
        mark: kept.mark,
      }
    return { ...base, ...none, open: false, address: '', title: '', viewport: 'fit', place: 'waiting' }
  }

  /**
   * Tells the windows of a page a lead opened or woke that none shows, so they place it beside its conversation, and
   * gives the one on screen a moment to lay it out: where its conversation isn't on screen, it stays out of sight.
   */
  const offer = async (page: Page) => {
    if (page.panel !== null) return
    options.opened(page.owner.id)
    for (let waited = 0; page.panel === null && waited < pace.settle * 6; waited += pace.poll) await pause(pace.poll)
  }

  /** The page an agent works on: alive, or woken where it was; null where nothing is open. A page woken is shown beside its conversation by the windows. */
  const forAgent = async (owner: Owner): Promise<Page | null> => {
    const found = live(owner.id)
    if (found !== null) return used(found)
    if (!asleep.has(owner.id)) return null
    const woke = pageOf(owner)
    await settled(woke, pace.load)
    await offer(woke)
    return used(woke)
  }
  /** A page an agent works on while no conversation shows it is the one hidden last, so the last put to sleep. */
  const used = (page: Page) => {
    if (page.panel === null) {
      hidings += 1
      page.hiddenSince = hidings
    }
    return page
  }

  const goOutsideAsked = (page: Page | null, verdict: Extract<Verdict, { kind: 'sign-in' }>, address: string) => {
    if (page !== null) goOutside(page, verdict, address)
    else options.outside(address)
  }

  const schemeOf = (address: string) => {
    try {
      return new URL(address).protocol
    } catch {
      return ''
    }
  }

  const opening = async (owner: Owner, call: Extract<PageCall, { op: 'open' }>, signal: AbortSignal | null): Promise<PageDone> => {
    const url = call.url
    const present = live(owner.id)
    const held = present === null ? null : heldUp(present, call)
    if (held !== null) return { error: held }
    const typed = typedAddress(url)
    if (typed === null) return { error: words.notAnAddress }
    const verdict = navigation(typed)
    if (verdict.kind === 'refuse') return { error: refusalWords(verdict.refusal, 'open', schemeOf(typed)) }
    if (verdict.kind === 'sign-in') {
      // A sign-in goes to the person's browser, as it does from the page's own bar; with no page open, there is none to say so.
      const page = live(owner.id) ?? (asleep.has(owner.id) ? pageOf(owner) : null)
      goOutsideAsked(page, verdict, typed)
      return { error: signInWords(verdict.service, 'open') }
    }
    const page = used(pageOf(owner))
    return alone(page, call, signal, async () => {
      busy(page)
      try {
        await watch(page)
        page.leftUnsaved = false
        const mark = page.logs.mark()
        page.line = null
        await within(
          page.contents.loadURL(typed).catch(() => undefined),
          pace.load,
        )
        // What the page loads after its document (its frames, what it fetches) is waited for as long as a load is.
        await settled(page, pace.load)
        await offer(page)
        const line = page.line as PageLine | null
        if (line !== null && (line.kind === 'failed' || line.kind === 'gone'))
          return { error: `${lineWords(line)} Check that it is running (run_project starts the project), then open it again.` }
        if (line !== null && (line.kind === 'refused' || line.kind === 'sign-in')) return { error: lineWords(line) ?? words.unreadable }
        const state = stateOf(page)
        return {
          value: {
            text: [
              `Opened ${shownOf(state.address, state.title)}, ${placeWords(placeOf(page))}.`,
              ...(state.loading ? [words.stillLoading] : []),
              ...(page.leftUnsaved ? [words.leftUnsaved] : []),
              ...(line === null ? [] : [lineWords(line) ?? '']),
              troubleSince(page.logs, mark),
              ...(page.dialog === null ? [] : [dialogWords(page.dialog, true)]),
              `Log mark: ${page.logs.mark()}.`,
            ]
              .filter((part) => part !== '')
              .join('\n'),
          },
        }
      } finally {
        fade(page)
      }
    })
  }

  /** Back, forward, again or stop, as the bar does it. */
  const going = (page: Page, goTo: PageMove) => {
    const history = page.contents.navigationHistory
    if (goTo === 'back' && history.canGoBack()) history.goBack()
    if (goTo === 'forward' && history.canGoForward()) history.goForward()
    if (goTo === 'reload') page.contents.reload()
    if (goTo === 'stop') page.contents.stop()
    if (page.line?.kind === 'failed' || page.line?.kind === 'gone') said(page, null)
  }

  const moving = (page: Page, call: Extract<PageCall, { op: 'move' }>, signal: AbortSignal | null): Promise<PageDone> =>
    alone(page, call, signal, async () => {
      const goTo = call.move
      const history = page.contents.navigationHistory
      if (goTo === 'back' && !history.canGoBack()) return { error: 'There is no earlier page to go back to.' }
      if (goTo === 'forward' && !history.canGoForward()) return { error: 'There is no later page to go forward to.' }
      busy(page)
      try {
        page.leftUnsaved = false
        const before = { address: page.contents.getURL(), line: page.line, mark: page.logs.mark() }
        going(page, goTo)
        await pause(pace.settle)
        await settled(page, pace.load)
        const state = stateOf(page)
        const guard = page.line === before.line ? null : lineWords(page.line)
        return {
          value: {
            text: [
              `${{ back: 'Went back to', forward: 'Went forward to', reload: 'Reloaded', stop: 'Stopped loading' }[goTo]} ${shownOf(state.address, state.title)}.`,
              page.leftUnsaved ? words.leftUnsaved : '',
              guard ?? '',
              troubleSince(page.logs, before.mark),
              page.dialog === null ? '' : dialogWords(page.dialog, true),
              `Log mark: ${page.logs.mark()}.`,
            ]
              .filter((part) => part !== '')
              .join('\n'),
          },
        }
      } finally {
        fade(page)
      }
    })

  const viewing = (page: Page, call: Extract<PageCall, { op: 'viewport' }>, signal: AbortSignal | null): Promise<PageDone> =>
    alone(page, call, signal, async () => {
      const viewport = call.viewport
      busy(page)
      try {
        page.viewport = viewport
        place(page)
        tell(page)
        await pause(pace.settle)
        await settled(page, pace.load)
        return { value: { text: `The page is laid out as ${viewportWords(viewport)}.` } }
      } finally {
        fade(page)
      }
    })

  const reading = async (page: Page, target: PageTarget | null): Promise<PageDone> => {
    const loaded = await settled(page, pace.load)
    const document = page.document
    const snapshot = snapshotOf(await ask(page, 'snapshot', target === null ? null : targetOf(target), SNAPSHOT_LIMIT))
    if (snapshot === null) return { error: words.unreadable }
    if (!snapshot.ok) return { error: snapshot.why }
    // Its refs name elements of the document it read; one that loaded while it read gets read again before they are used.
    page.refsDocument = page.document === document ? document : -1
    const state = stateOf(page)
    return {
      value: {
        text: [
          snapshotWords(pageHeader(state.address, state.title, state.viewport), snapshot, target),
          ...(loaded ? [] : [words.stillLoading]),
        ].join('\n'),
      },
    }
  }

  /** The whole page as one picture, through the debugger: its document's length, cut at the tallest taken; null where it can't be taken. */
  const wholePage = async (page: Page): Promise<{ readonly png: string; readonly width: number; readonly height: number } | null> => {
    // A page drawn smaller than its size (a device in a narrow panel) has no whole page to take this way.
    if (page.scale !== 1) return null
    try {
      debugging(page)
      const metrics = await answered(
        cdp<{ cssContentSize?: { width: number; height: number }; contentSize: { width: number; height: number } }>(
          page,
          'Page.getLayoutMetrics',
        ),
        'for its size',
      )
      const size = metrics.cssContentSize ?? metrics.contentSize
      const width = Math.max(1, Math.ceil(size.width))
      const height = Math.max(1, Math.min(TALLEST, Math.ceil(size.height)))
      const shot = await answered(
        cdp<{ data: string }>(page, 'Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
          fromSurface: true,
          clip: { x: 0, y: 0, width, height, scale: 1 },
        }),
        'for a picture of it',
      )
      const dimensions = pngSize(shot.data)
      return dimensions === null ? null : { png: shot.data, ...dimensions }
    } catch {
      return null
    }
  }

  const shooting = async (page: Page, call: Extract<PageCall, { op: 'screenshot' }>): Promise<PageDone> => {
    await settled(page, pace.load)
    // A page no conversation shows is laid out at its viewport's own size, to be drawn whole.
    if (page.panel === null) {
      unseen(page)
      await pause(pace.settle)
    }
    // The lead's own outlines aren't the page: they go first, and the page is drawn again without them.
    const outlines = await ask(page, 'unmark').catch(() => 0)
    if (typeof outlines === 'number' && outlines > 0)
      await answered(heldBy(page, run(page, REPAINTED)), 'as it drew itself again').catch(() => undefined)
    const state = stateOf(page)
    const where = page.panel === null ? 'off screen' : 'beside the conversation'
    const head = `A screenshot of ${shownOf(state.address, state.title)}, as drawn ${where}`
    const tail = `at viewport ${viewportWords(state.viewport)}`
    let picture: NativeImage | null = null
    let wanted = 0
    let what = ''
    let note = ''
    if (call.target !== null) {
      const found = await finding(page, call.target, true)
      if (typeof found === 'string') return { error: found }
      const layout = layoutOf(await ask(page, 'layout'))
      if (layout === null) return { error: words.unreadable }
      const crop = cropOf(found.rect, { width: layout.width, height: layout.height }, 0, TALLEST)
      if (crop === null) return { error: `${named_(found)} takes up no space on the page, or none of it shows in the viewport.` }
      picture = await answered(heldBy(page, page.contents.capturePage(scaled(crop, page.scale))), 'for a picture of it').catch(() => null)
      wanted = Math.ceil(crop.width * page.scale)
      what = `, the element ${targetWords(call.target)}`
    } else if (call.fullPage) {
      const whole = await wholePage(page)
      if (whole !== null)
        return { value: { text: `${head}, the whole page, ${tail}: ${whole.width}×${whole.height} pixels, at 1×.`, picture: whole } }
      note = ' The whole page couldn’t be taken, so this is what shows.'
    }
    if (picture === null && call.target === null) {
      picture = await answered(heldBy(page, page.contents.capturePage()), 'for a picture of it').catch(() => null)
      wanted = page.view.getBounds().width
    }
    if (page.dialog !== null) return { error: dialogWords(page.dialog) }
    if (picture === null || picture.isEmpty())
      return { error: 'The page drew nothing to take a picture of. If it is loading or blank, wait a moment and try again.' }
    // At 1×: a screen at 2× draws twice as many pixels, which the agent would read for nothing.
    const sized = wanted > 0 && picture.getSize().width > wanted ? picture.resize({ width: wanted }) : picture
    const { width, height } = sized.getSize()
    return {
      value: {
        text: `${head}${what}, ${tail}: ${width}×${height} pixels, at 1×.${note}`,
        picture: { png: Buffer.from(sized.toPNG()).toString('base64'), width, height },
      },
    }
  }

  const clicking = (page: Page, call: Extract<PageCall, { op: 'click' }>): Promise<PageDone> =>
    doing(page, async (started) => {
      const found = await finding(page, call.target, true)
      if (typeof found === 'string') return { error: found }
      if (found.disabled) return { error: `${named_(found)} is disabled, so clicking it does nothing.` }
      if (!found.inView) return { error: `${named_(found)} is outside the viewport even scrolled to, so it can’t be pressed.` }
      outline(page, found.rect)
      const at = viewPoint(page, found.at)
      await mouse(page, 'mouseMoved', at, 'none', 0)
      const early = await yielded(page, started, '')
      if (early !== null) return early
      for (let n = 1; n <= (call.double ? 2 : 1); n += 1) {
        await mouse(page, 'mousePressed', at, call.button, n)
        started.hand.injected += 1
        await mouse(page, 'mouseReleased', at, call.button, n)
        const stopped = await yielded(page, started, 'the press had been made')
        if (stopped !== null) return stopped
      }
      const verb = call.double
        ? 'Double-clicked'
        : call.button === 'right'
          ? 'Right-clicked'
          : call.button === 'middle'
            ? 'Middle-clicked'
            : 'Clicked'
      return {
        value: {
          text: acted(verb, found, [coveredWords(found.covered), ...(await aftermath(page, started)), `Log mark: ${page.logs.mark()}.`]),
        },
      }
    })

  const hovering = (page: Page, call: Extract<PageCall, { op: 'hover' }>): Promise<PageDone> =>
    doing(page, async (started) => {
      const found = await finding(page, call.target, true)
      if (typeof found === 'string') return { error: found }
      if (!found.inView) return { error: `${named_(found)} is outside the viewport even scrolled to, so the pointer can’t be put over it.` }
      outline(page, found.rect)
      await mouse(page, 'mouseMoved', viewPoint(page, found.at), 'none', 0)
      const stopped = await yielded(page, started, '')
      if (stopped !== null) return stopped
      return { value: { text: acted('Moved the pointer over', found, [coveredWords(found.covered), ...(await aftermath(page, started))]) } }
    })

  const typing = (page: Page, call: Extract<PageCall, { op: 'type' }>): Promise<PageDone> =>
    doing(page, async (started) => {
      const found = await finding(page, call.target, true)
      if (typeof found === 'string') return { error: found }
      if (found.disabled) return { error: `${named_(found)} is disabled, so nothing can be typed in it.` }
      if (!found.editable) return { error: `${named_(found)} isn’t a field to type in. page_click presses buttons and links.` }
      outline(page, found.rect)
      const focused = doneOf(await ask(page, 'focus', targetOf(call.target)))
      if (focused === null) return { error: words.unreadable }
      if (!focused.ok) return { error: focused.why }
      if (call.replace) {
        const selected = doneOf(await ask(page, 'selectAll', targetOf(call.target)))
        if (selected !== null && !selected.ok) return { error: selected.why }
      }
      const early = await yielded(page, started, '')
      if (early !== null) return early
      let notes: ReadonlyArray<string> = []
      if (call.text !== '') {
        const valueNow = () =>
          ask(page, 'valueOf', targetOf(call.target)).then(
            (one) => (typeof one === 'string' ? one : null),
            () => null,
          )
        const before = await valueNow()
        await input(page, 'Input.insertText', { text: call.text })
        const stopped = await yielded(page, started, 'some of it was typed')
        if (stopped !== null) return stopped
        const after = await valueNow()
        // Typing that didn't change the field at all (one that ignores inserted text) is set the way typing sets it, and
        // said. A field that took it its own way (a mask, an editor's formatting) is left as it took it.
        const ignored = before !== null && after === before && !(call.replace && before === call.text)
        if (ignored) {
          const filled = filledOf(await ask(page, 'fill', targetOf(call.target), call.text, call.replace))
          if (filled === null || !filled.ok) return { error: filled === null ? words.unreadable : filled.why }
          notes = ['The field ignored typing, so its value was set instead.']
        } else if (after !== null && !after.includes(call.text))
          notes = [
            'The field changed what was typed as it took it (a mask, or an editor’s own formatting). page_snapshot shows what it holds now.',
          ]
      } else if (call.replace) {
        // Nothing to type over what is selected: it is deleted, as a person would.
        const clear = chordOf('Backspace', mac)
        if (clear.ok) {
          await strike(page, clear.strokes)
          started.hand.injected += keydowns(clear.strokes)
          const stopped = await yielded(page, started, 'the field had been selected')
          if (stopped !== null) return stopped
        }
      }
      if (call.submit) {
        const enter = chordOf('Enter', mac)
        if (enter.ok) {
          await strike(page, enter.strokes)
          started.hand.injected += keydowns(enter.strokes)
          const stopped = await yielded(page, started, 'the text was typed')
          if (stopped !== null) return stopped
        }
      }
      const length = Array.from(call.text).length
      const did = length === 0 ? (call.replace ? 'Cleared' : 'Typed nothing') : `Typed ${length} character${length === 1 ? '' : 's'}`
      return {
        value: {
          text: acted(`${did}${call.submit ? ' and pressed Enter' : ''}${length === 0 && call.replace ? '' : ' in'}`, found, [
            ...notes,
            ...(await aftermath(page, started)),
            `Log mark: ${page.logs.mark()}.`,
          ]),
        },
      }
    })

  const pressing = (page: Page, call: Extract<PageCall, { op: 'press' }>): Promise<PageDone> =>
    doing(page, async (started) => {
      const chord = chordOf(call.key, mac)
      if (!chord.ok) return { error: chord.why }
      let found: Found | null = null
      if (call.target !== null) {
        const located = await finding(page, call.target, true)
        if (typeof located === 'string') return { error: located }
        found = located
        outline(page, found.rect)
        const focused = doneOf(await ask(page, 'focus', targetOf(call.target)))
        if (focused !== null && !focused.ok) return { error: focused.why }
      }
      const early = await yielded(page, started, '')
      if (early !== null) return early
      await strike(page, chord.strokes)
      started.hand.injected += keydowns(chord.strokes)
      const stopped = await yielded(page, started, 'the key had been pressed')
      if (stopped !== null) return stopped
      return {
        value: {
          text: acted(found === null ? `Pressed ${call.key}` : `Pressed ${call.key} on`, found, [
            ...(await aftermath(page, started)),
            `Log mark: ${page.logs.mark()}.`,
          ]),
        },
      }
    })

  const scrolling = (page: Page, call: Extract<PageCall, { op: 'scroll' }>): Promise<PageDone> =>
    doing(page, async (started) => {
      if (call.target !== null && call.to === null && call.by === null) {
        const found = await finding(page, call.target, true)
        if (typeof found === 'string') return { error: found }
        // Looking for it scrolled it into view: where the person used the page meanwhile, the action stops here.
        const stopped = await yielded(page, started, '')
        if (stopped !== null) return stopped
        return { value: { text: acted('Scrolled into view', found, []) } }
      }
      const early = await yielded(page, started, '')
      if (early !== null) return early
      const to = call.to === null && call.by === null ? 'down' : call.to
      const scrolled = scrolledOf(await ask(page, 'scroll', call.target === null ? null : targetOf(call.target), to, call.by))
      if (scrolled === null) return { error: words.unreadable }
      if (!scrolled.ok) return { error: scrolled.why }
      const layout = layoutOf(await ask(page, 'layout'))
      return {
        value: {
          text: [scrolledWords(scrolled, call.target === null ? layout : null), ...(await aftermath(page, started))]
            .filter((part) => part !== '')
            .join('\n'),
        },
      }
    })

  const selecting = (page: Page, call: Extract<PageCall, { op: 'select' }>): Promise<PageDone> =>
    doing(page, async (started) => {
      const found = await finding(page, call.target, true)
      if (typeof found === 'string') return { error: found }
      if (found.disabled) return { error: `${named_(found)} is disabled, so nothing can be chosen in it.` }
      outline(page, found.rect)
      // Choosing changes the page (a select may submit on change): where the person used it meanwhile, it isn't chosen.
      const early = await yielded(page, started, '')
      if (early !== null) return early
      const chosen = chosenOf(await ask(page, 'select', targetOf(call.target), call.values))
      if (chosen === null) return { error: words.unreadable }
      if (!chosen.ok) return { error: chosen.why }
      return {
        value: { text: acted(`Chose ${chosen.chosen.map((one) => `“${one}”`).join(', ')} in`, found, await aftermath(page, started)) },
      }
    })

  /**
   * What a wait still lacks, in words; nothing where all it was asked for holds. Each look has until `until`; one the
   * page didn't answer in time is neither there nor gone.
   */
  const unmet = async (page: Page, call: Extract<PageCall, { op: 'wait' }>, until: number): Promise<ReadonlyArray<string>> => {
    const lacking: Array<string> = []
    let unanswered = false
    const look = async (query: { text?: string; selector?: string; ref?: string }) => {
      const found = await holds(page, query, Math.max(1, until - Date.now()))
      if (found === null) unanswered = true
      return found
    }
    if (call.text !== null && (await look({ text: call.text })) === false) lacking.push(`the words “${call.text}” haven’t shown`)
    if (call.gone !== null && (await look({ text: call.gone })) === true) lacking.push(`the words “${call.gone}” are still there`)
    if (call.target !== null && (await look(targetOf(call.target))) === false) lacking.push(`${targetWords(call.target)} isn’t on the page`)
    if (unanswered) lacking.push(words.unanswered)
    return lacking
  }

  const waiting = async (page: Page, call: Extract<PageCall, { op: 'wait' }>, signal: AbortSignal | null): Promise<PageDone> => {
    const seconds = `${call.seconds} second${call.seconds === 1 ? '' : 's'}`
    if (call.text === null && call.gone === null && call.target === null) {
      await pause(call.seconds * 1_000)
      return { value: { text: `Waited ${seconds}.` } }
    }
    // The time asked for is the time it takes, however long each look at the page takes.
    const until = Date.now() + call.seconds * 1_000
    const every = Math.max(1, pace.poll)
    let lacking = await unmet(page, call, until)
    while (lacking.length > 0 && Date.now() < until) {
      await pause(Math.min(every, Math.max(1, until - Date.now())))
      if (page.contents.isDestroyed()) return { error: 'The page closed while waiting.' }
      if (signal?.aborted === true) return { error: words.gaveUp }
      if (page.dialog !== null) return { error: dialogWords(page.dialog) }
      lacking = await unmet(page, call, until)
    }
    if (page.dialog !== null) return { error: dialogWords(page.dialog) }
    if (lacking.length > 0) return { error: `After ${seconds}, ${lacking.join(' and ')}.` }
    return { value: { text: 'It is there now.' } }
  }

  const evaluating = (page: Page, script: string): Promise<PageDone> =>
    doing(page, async (started) => {
      const late = Symbol('late')
      // The agent's own script runs as a press of the person's would let it (a video played, a field focused); the probe only compiles.
      const racing = async (code: string, gesture: boolean): Promise<unknown> => {
        const result = await Promise.race([
          heldBy(page, page.contents.executeJavaScriptInIsolatedWorld(WORLD_EVAL, [{ code }], gesture) as Promise<unknown>),
          pause(pace.script).then(() => late),
        ])
        if (result === late)
          throw new Error(
            `the script ran longer than ${Math.round(pace.script / 1_000)} seconds, so Althar stopped waiting; it may still be running in the page`,
          )
        return result
      }
      // An expression is run as one; anything else as statements that `return` what they give back. Which it is, is found by compiling, never by running.
      const body = script.replace(/[\s;]+$/, '')
      const expression = await racing(`(() => { void (async () => (${body}\n)); return true })()`, false).then(
        () => true,
        () => false,
      )
      // Compiling gave the page nothing to do: the person using it meanwhile, or the call being given up on, stops it here.
      const early = await yielded(page, started, '')
      if (early !== null) return early
      let value: unknown
      try {
        value = await racing(expression ? `(async () => (${body}\n))()` : `(async () => {${script}\n})()`, true)
      } catch (error) {
        if (error instanceof DialogOpen) throw error
        return { error: `The script threw: ${error instanceof Error ? error.message : String(error)}` }
      }
      const hint = !expression && value === undefined ? ['(A script of statements gives back what it `return`s.)'] : []
      return { value: { text: [answerOf(value), ...hint, ...(await aftermath(page, started))].filter((part) => part !== '').join('\n') } }
    })

  /** Answers the dialog the page shows, as its buttons would, and says what that set going. */
  const answering = (page: Page, call: Extract<PageCall, { op: 'dialog' }>, signal: AbortSignal | null): Promise<PageDone> =>
    alone(page, call, signal, async () => {
      const dialog = page.dialog
      if (dialog === null) return { error: words.noDialog }
      busy(page)
      try {
        page.leftUnsaved = false
        const run: Run = { hand: { baseline: 0, injected: 0 }, address: page.contents.getURL(), line: page.line, mark: page.logs.mark() }
        await answered(
          cdp(page, 'Page.handleJavaScriptDialog', { accept: call.accept, ...(call.text === null ? {} : { promptText: call.text }) }),
          'the answer to its dialog',
        )
        page.dialog = null
        // The action that opened the dialog left its focus emulation on, which a page a dialog holds can't be told.
        await relax(page)
        // Electron draws the dialog on the window as well (a sheet on a Mac), which the debugger's answer leaves there:
        // its own handler of the page's dialogs takes it away at this word, the answer already given. (The e2e sees it go.)
        ;(page.contents as unknown as { emit: (name: string) => boolean }).emit('-cancel-dialogs')
        const after = await aftermath(page, run)
        return {
          value: {
            text: [answeredWords(dialog, call.accept, call.text), ...after, `Log mark: ${page.logs.mark()}.`]
              .filter((part) => part !== '')
              .join('\n'),
          },
        }
      } finally {
        fade(page)
      }
    })

  const logging = (page: Page, call: Extract<PageCall, { op: 'logs' }>): PageDone => {
    const read = readLogs(page.logs, call.since, call.kind)
    return { value: { text: logWords(read, call.since, call.kind) } }
  }

  const driven = async (ownerId: string, call: PageCall, signal: AbortSignal | null): Promise<PageDone> => {
    const owner = ownerOf(ownerId)
    if (owner === null) return { error: words.noPage }
    if (options.quitting()) return { error: words.quitting }
    if (call.op === 'state') return { value: { text: stateWords(factsOf(owner)) } }
    if (options.windows() === 0) return { error: words.noWindow(owner.kind) }
    if (call.op === 'open') return opening(owner, call, signal)
    const page = await forAgent(owner)
    if (page === null) return { error: words.nothingOpen(owner.kind) }
    if (call.op === 'logs') return logging(page, call)
    // Reading needs the debugger too: it tells of a dialog that holds the page, which nothing else can.
    await watch(page)
    const held = heldUp(page, call)
    if (held !== null) return { error: held }
    switch (call.op) {
      case 'wait':
        return waiting(page, call, signal)
      case 'move':
        return moving(page, call, signal)
      case 'viewport':
        return viewing(page, call, signal)
      case 'dialog':
        return answering(page, call, signal)
      case 'snapshot':
        return alone(page, call, signal, () => reading(page, call.target))
      case 'screenshot':
        return alone(page, call, signal, () => shooting(page, call))
      case 'click':
        return alone(page, call, signal, () => clicking(page, call))
      case 'hover':
        return alone(page, call, signal, () => hovering(page, call))
      case 'type':
        return alone(page, call, signal, () => typing(page, call))
      case 'press':
        return alone(page, call, signal, () => pressing(page, call))
      case 'scroll':
        return alone(page, call, signal, () => scrolling(page, call))
      case 'select':
        return alone(page, call, signal, () => selecting(page, call))
      case 'evaluate':
        return alone(page, call, signal, () => evaluating(page, call.script))
    }
  }

  /**
   * What an agent asks of the page beside its conversation; never throws: what can't be done is said in words.
   * `signal` ends where the runtime gave up on the call: what hasn't begun isn't done, and an action stops at its next step.
   */
  const drive = async (ownerId: string, call: PageCall, signal?: AbortSignal): Promise<PageDone> => {
    try {
      return await driven(ownerId, call, signal ?? null)
    } catch (error) {
      const dialog = live(ownerId)?.dialog ?? null
      if (error instanceof DialogOpen && dialog !== null) return { error: dialogWords(dialog) }
      return { error: words.couldNot(error instanceof Error ? error.message : String(error)) }
    }
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
        working: false,
      })),
    ],
    /** Lays the page over the window where it keeps its place, or takes it off while no conversation shows it. */
    show: (window: BrowserWindow, ownerId: string, panel: Rect | null, where?: 'beside' | 'tab') => {
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
      page.where = where ?? page.where ?? 'beside'
      page.zoom = window.webContents.getZoomFactor()
      place(page)
    },
    move: (ownerId: string, move: PageMove) => {
      const page = live(ownerId)
      if (page !== null) going(page, move)
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
    /**
     * What the lead (or the coordinator) asks of the page beside its own
     * conversation: reads it, opens, wakes and drives it, without asking the
     * person, and says in words what it did, or why not. Never throws.
     */
    drive,
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
