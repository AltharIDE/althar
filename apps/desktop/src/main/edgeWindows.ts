import { join } from 'node:path'

import { BrowserWindow, Menu, nativeImage, nativeTheme, type Rectangle, screen, Tray } from 'electron'

import { darkPanel, readSystemUsesLightTheme, type Scheme, watchColorScheme } from './colorScheme'
import { RAISED } from './windowOptions'
import {
  DEFAULT_EDGE,
  type EdgePlace,
  edgeIn,
  findNotch,
  markFile,
  type Notch,
  pointerOn,
  readEdge,
  sheetBounds,
  trayItems,
  writeEdge,
} from './edge'

/*
 * The edge of the screen, drawn (edge.ts holds the choice and finds the
 * notch). The island is a panel round the notch: it never takes focus from
 * what you type in, shows on every Space and over full-screen apps, and lets
 * clicks through wherever it draws nothing, until the pointer is on it. It
 * sits over the menu bar's own items, which is above where macOS tells a
 * window of an app in the background that the pointer came in, so this
 * process watches the pointer itself (`POINTER`) and tells the page. The
 * menu bar's is Althar's mark, which drops a sheet under it; the mark gets a
 * dot while something waits on you. Both are for while you work in another
 * app: while one of Althar's windows has focus, on any screen, the island
 * hides and, on a Mac, the mark leaves the menu bar. Each page is
 * renderer/edge.html, with a port to the runtime like the window's, so it
 * reads and answers for itself.
 */

/** What the edge needs from the rest of the main process. */
export interface EdgeHost {
  /** The profile its choice is kept in. */
  readonly profile: () => string
  /** Gives a page a port to the runtime, once each time it loads. */
  readonly connect: (window: BrowserWindow) => void
  readonly preload: string
  /** renderer/edge.html. */
  readonly page: string
  /** Brings Althar's window forward: the tray's menu, off a Mac, opens it. */
  readonly open: () => void
  /** Quits Althar. */
  readonly quit: () => void
  /** resources/tray, the menu bar's pictures. */
  readonly pictures: string
  /** The end-to-end tests' quiet run (main.ts): the island is drawn clear and never takes the pointer. */
  readonly quiet?: boolean
}

/** The island's window: room for it open, and for a call said beside the notch. Clicks go through what it doesn't draw. */
const ISLAND = { width: 600, height: 640 }
/** The menu bar's sheet, as wide as the page draws it; as tall as what it holds, up to the screen. */
const SHEET = { width: 360, height: 420, gap: 6 }
/** How long the screens settle after a change before the notch is looked for again. */
const SETTLE = 400
/** How often the pointer is looked at, while there is an island: often enough to feel at once, rarely enough to cost nothing. */
const POINTER = 80

const shared = (preload: string) => ({
  show: false,
  frame: false,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  hiddenInMissionControl: true,
  alwaysOnTop: true,
  // On a Mac a panel floats over every Space and over full-screen apps, without making Althar the active app.
  type: 'panel',
  webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
})

/** Where the edge is, as Settings says it: what the person chose, and what this computer has room for. */
export interface EdgeState {
  readonly place: EdgePlace
  /** A screen has a notch, to choose the island by. */
  readonly notch: boolean
  /** The system, as Node names it: darwin, win32, linux. */
  readonly platform: NodeJS.Platform
  /** The system has a tray, or a menu bar, to put the mark in: not every Linux desktop has. */
  readonly tray: boolean
}

export interface Edge {
  /** Where it is, once the choice is read and the notch looked for the first time. */
  readonly state: () => Promise<EdgeState>
  readonly choose: (place: EdgePlace) => Promise<void>
  /** How many calls wait on the person: the menu bar's mark gets its dot. */
  readonly waiting: (count: number) => void
  /** A page of the edge, rather than one of Althar's windows. */
  readonly owns: (window: BrowserWindow) => boolean
  /** Where the island draws in its page, as it changes: the pointer is watched against it. */
  readonly drawn: (window: BrowserWindow, rect: Rectangle) => void
  /** How tall the menu bar's sheet draws. */
  readonly sized: (window: BrowserWindow, height: number) => void
  /** Closes the menu bar's sheet, as after it opened something. */
  readonly settle: () => void
  /** Whether one of Althar's windows has focus: the edge steps aside while it has. */
  readonly front: (front: boolean) => void
}

export const startEdge = (host: EdgeHost): Edge => {
  let chosen: EdgePlace = DEFAULT_EDGE
  let notch: Notch | null = null
  let island: BrowserWindow | undefined
  let tray: Tray | undefined
  let sheet: BrowserWindow | undefined
  let waiting = 0
  /** Where the island draws, in its page; whether the pointer is on it; and the notch its page was drawn for. */
  let drawn: Rectangle | null = null
  let pointed = false
  let drawnFor: { readonly width: number; readonly height: number } | null = null
  /** Each look for the notch, counted, so one that answers late can't undo a later one. */
  let looking = 0
  /** Whether one of Althar's windows has focus, when nothing shows at the edge. */
  let inFront = false
  /** The system said it has no tray to put the mark in, the last time it was asked for one. */
  let trayless = false
  /** The mark leaves the menu bar while Althar is in front only on a Mac: elsewhere a tray's icon stays, as the system's own do. */
  const markSteps = process.platform === 'darwin'

  const load = (window: BrowserWindow, query: Record<string, string>) => {
    window.webContents.on('did-finish-load', () => host.connect(window))
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    void window.loadFile(host.page, { query })
  }

  /* ---- the island ---- */

  const islandBounds = (at: Notch) => ({
    x: Math.round(at.x + at.width / 2 - ISLAND.width / 2),
    y: Math.round(at.y),
    width: ISLAND.width,
    height: ISLAND.height,
  })

  const showIsland = (at: Notch) => {
    const size = { width: Math.round(at.width), height: Math.round(at.height) }
    // Moved, it keeps its page; a notch of another size (the screen scaled) is drawn afresh.
    if (island !== undefined && !island.isDestroyed()) {
      if (drawnFor?.width === size.width && drawnFor.height === size.height) return island.setBounds(islandBounds(at))
      dropIsland()
    }
    const made = new BrowserWindow({
      ...shared(host.preload),
      ...islandBounds(at),
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      roundedCorners: false,
      // Typing stays where it was; a first click on it still lands.
      focusable: false,
      acceptFirstMouse: true,
      // It sits in the menu bar, where a window may otherwise not go.
      enableLargerThanScreen: true,
    })
    made.setIgnoreMouseEvents(true, { forward: true })
    if (host.quiet === true) made.setOpacity(0)
    // Over the menu bar and its items, under a menu that opens later.
    made.setAlwaysOnTop(true, 'pop-up-menu')
    made.once('ready-to-show', () => {
      if (!inFront) made.showInactive()
    })
    made.on('closed', () => {
      if (island === made) island = undefined
    })
    load(made, { place: 'island', notchWidth: String(size.width), notchHeight: String(size.height) })
    island = made
    drawnFor = size
  }

  const dropIsland = () => {
    island?.destroy()
    island = undefined
    drawn = null
    drawnFor = null
    pointed = false
  }

  /** Shows the island, or hides it while Althar is in front: closed first, so it comes back at rest. */
  const placeIsland = () => {
    if (island === undefined || island.isDestroyed()) return
    if (!inFront) {
      if (!island.isVisible() && !island.webContents.isLoading()) island.showInactive()
      return
    }
    if (pointed) {
      pointed = false
      island.setIgnoreMouseEvents(true, { forward: true })
      island.webContents.send('althar:edge-pointed', false)
    }
    island.hide()
  }

  /* Clicks land on the island while the pointer is on what it draws, and go through elsewhere; the page hears which, to open and close. */
  const watch = setInterval(() => {
    if (island === undefined || island.isDestroyed() || drawn === null || !island.isVisible() || host.quiet === true) return
    // Against where the window is now, which a change of screens may have moved.
    const on = pointerOn(drawn, island.getBounds(), screen.getCursorScreenPoint())
    if (on === pointed) return
    pointed = on
    island.setIgnoreMouseEvents(!on, { forward: true })
    island.webContents.send('althar:edge-pointed', on)
  }, POINTER)
  watch.unref?.()

  /* ---- the menu bar ---- */

  let scheme: Scheme | undefined
  let taskbarLight: boolean | undefined
  const picture = (yours: boolean) => {
    // The Windows taskbar follows the system theme (SystemUsesLightTheme), not the apps' (nativeTheme).
    // On Linux Electron's nativeTheme says light where it has no word, on a dark panel too, so the desktop's setting comes from
    // the Settings portal; with none, most panels are dark: the mark is light.
    // Until it is read, the system's own (the taskbar's) scheme, never the app's: Settings › Appearance may differ from it.
    let dark = process.platform === 'win32' ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI : nativeTheme.shouldUseDarkColors
    if (process.platform === 'linux') dark = darkPanel(scheme)
    else if (taskbarLight !== undefined) dark = !taskbarLight
    const image = nativeImage.createFromPath(join(host.pictures, markFile(process.platform, dark, yours)))
    // The menu bar draws a template in its own colour, light or dark, whatever is behind it; elsewhere the file is the colour.
    if (process.platform === 'darwin') image.setTemplateImage(true)
    return image
  }

  /** The menu off a Mac, where the mark may not take a click (an AppIndicator ignores it) and may not show without a menu. */
  const trayMenu = () =>
    Menu.buildFromTemplate(
      trayItems(waiting).map((item) =>
        'separator' in item
          ? { type: 'separator' as const }
          : { label: item.label, click: () => (item.action === 'quit' ? host.quit() : host.open()) },
      ),
    )

  /** Beside the mark, on the screen it is on (`sheetBounds`). */
  const sheetPlace = (height: number) => {
    const bounds = tray?.getBounds()
    const mark = bounds !== undefined && bounds.width > 0 ? bounds : null
    const point = mark === null ? screen.getCursorScreenPoint() : { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 }
    const { workArea } = screen.getDisplayNearestPoint(point)
    return sheetBounds({ mark, workArea, size: { width: SHEET.width, height }, gap: SHEET.gap, mac: process.platform === 'darwin' })
  }

  /** The sheet's paper, light or dark as the app's appearance makes the scheme. */
  const sheetPaper = () => (nativeTheme.shouldUseDarkColors ? RAISED.dark : RAISED.light)
  // Changed while it is made, its paper follows, as its page does.
  nativeTheme.on('updated', () => {
    if (sheet !== undefined && !sheet.isDestroyed()) sheet.setBackgroundColor(sheetPaper())
  })

  const makeSheet = (): BrowserWindow => {
    const made = new BrowserWindow({
      ...shared(host.preload),
      ...sheetPlace(SHEET.height),
      // Paper, with the system's own corners and shadow, as a menu has; the kit's raised shade (--n-1) in the theme's scheme.
      backgroundColor: sheetPaper(),
      hasShadow: true,
      roundedCorners: true,
    })
    // Clicking anywhere else puts it away, as a menu goes.
    made.on('blur', () => made.hide())
    made.on('closed', () => {
      if (sheet === made) sheet = undefined
    })
    load(made, { place: 'menu' })
    sheet = made
    return made
  }

  const toggleSheet = () => {
    const shown = sheet !== undefined && !sheet.isDestroyed() && sheet.isVisible()
    if (shown) return sheet?.hide()
    const made = sheet !== undefined && !sheet.isDestroyed() ? sheet : makeSheet()
    made.setBounds(sheetPlace(made.getBounds().height))
    const open = () => {
      made.show()
      made.focus()
    }
    if (made.webContents.isLoading()) made.once('ready-to-show', open)
    else open()
  }

  const showTray = () => {
    if (tray !== undefined && !tray.isDestroyed()) return
    tray = new Tray(picture(waiting > 0))
    tray.setToolTip('Althar')
    tray.on('click', toggleSheet)
    // Off a Mac the sheet's click may never come (AppIndicator), so the menu carries what it would.
    if (process.platform !== 'darwin') tray.setContextMenu(trayMenu())
    // Made now and kept hidden, so the first click opens it at once, already read.
    if (sheet === undefined || sheet.isDestroyed()) makeSheet()
  }

  /** Takes the mark out of the menu bar; its sheet is kept, hidden, for when it comes back. */
  const hideMark = () => {
    tray?.destroy()
    tray = undefined
    sheet?.hide()
  }

  const dropTray = () => {
    hideMark()
    sheet?.destroy()
    sheet = undefined
  }

  /* ---- which, and where ---- */

  const apply = () => {
    if (edgeIn(chosen, notch) === 'island' && notch !== null) {
      dropTray()
      showIsland(notch)
      placeIsland()
    } else {
      dropIsland()
      if (inFront && markSteps) return hideMark()
      try {
        showTray()
        trayless = false
      } catch {
        // Where the system has no menu bar to put it in (a desktop without a tray), there is no edge, and Settings says so. A
        // desktop may also take the mark without a tray to show it in, which Electron doesn't say; Settings mentions that too.
        trayless = true
      }
    }
  }

  const look = async () => {
    const mine = ++looking
    const found = await findNotch(screen.getPrimaryDisplay().bounds.height)
    if (mine !== looking) return
    notch = found
    apply()
  }

  let settling: ReturnType<typeof setTimeout> | undefined
  const changed = () => {
    clearTimeout(settling)
    settling = setTimeout(() => void look(), SETTLE)
  }
  screen.on('display-added', changed)
  screen.on('display-removed', changed)
  screen.on('display-metrics-changed', changed)

  const redraw = () => {
    if (tray !== undefined && !tray.isDestroyed()) tray.setImage(picture(waiting > 0))
  }

  // The system's mode changes under a Windows taskbar: the setting is read again and the mark is drawn in the other colour.
  if (process.platform === 'win32') {
    const reread = () =>
      readSystemUsesLightTheme((light) => {
        taskbarLight = light
        redraw()
      })
    nativeTheme.on('updated', reread)
    reread()
  }

  // On Linux the portal tells when the desktop's light/dark setting changes, and the mark is drawn again.
  if (process.platform === 'linux') {
    const stop = watchColorScheme((next) => {
      scheme = next
      redraw()
    })
    // On the process's exit, not will-quit: quitting ends in app.exit (main.ts), which skips will-quit, and a monitor left
    // running outlives Althar.
    process.once('exit', stop)
  }

  const first = readEdge(host.profile()).then((place) => {
    chosen = place
    return look()
  })

  return {
    state: async () => {
      await first
      return { place: chosen, notch: notch !== null, platform: process.platform, tray: !trayless }
    },
    // Kept first, so a choice that can't be kept changes nothing, and Settings, going back, says what is so.
    choose: async (place) => {
      await writeEdge(host.profile(), place)
      chosen = place
      apply()
    },
    waiting: (count) => {
      waiting = count
      if (tray === undefined || tray.isDestroyed()) return
      tray.setImage(picture(count > 0))
      if (process.platform !== 'darwin') tray.setContextMenu(trayMenu())
    },
    owns: (window) => window === island || window === sheet,
    drawn: (window, rect) => {
      if (window === island) drawn = rect
    },
    sized: (window, height) => {
      if (window !== sheet || !Number.isFinite(height) || height <= 0) return
      const place = sheetPlace(Math.ceil(height))
      window.setBounds(window.isVisible() ? { ...window.getBounds(), height: place.height } : place)
    },
    settle: () => sheet?.hide(),
    front: (front) => {
      if (front === inFront) return
      inFront = front
      apply()
    },
  }
}
