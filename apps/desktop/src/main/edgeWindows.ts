import { join } from 'node:path'

import { BrowserWindow, nativeImage, type Rectangle, screen, Tray } from 'electron'

import { DEFAULT_EDGE, type EdgePlace, edgeIn, findNotch, type Notch, readEdge, writeEdge } from './edge'

/*
 * The edge of the screen, drawn (edge.ts holds the choice and finds the
 * notch). The island is a panel round the notch: it never takes focus from
 * what you type in, shows on every Space and over full-screen apps, and lets
 * clicks through wherever it draws nothing, until the pointer is on it. It
 * sits over the menu bar's own items, which is above where macOS tells a
 * window of an app in the background that the pointer came in, so this
 * process watches the pointer itself (`POINTER`) and tells the page. The
 * menu bar's is Althar's mark, which drops a sheet under it; the mark gets a
 * dot while something waits on you. Each page is renderer/edge.html, with a
 * port to the runtime like the window's, so it reads and answers for itself.
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
  /** resources/tray, the menu bar's pictures. */
  readonly pictures: string
}

/** The island's window: room for it open, and for a call said beside the notch. Clicks go through what it doesn't draw. */
const ISLAND = { width: 600, height: 640 }
/** The menu bar's sheet, as wide as the page draws it; as tall as what it holds, up to the screen. */
const SHEET = { width: 400, height: 420, gap: 6 }
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

export interface Edge {
  /** Where the person chose, and whether this Mac has a notch to choose the island by. */
  readonly state: () => { readonly place: EdgePlace; readonly notch: boolean }
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
}

export const startEdge = (host: EdgeHost): Edge => {
  let chosen: EdgePlace = DEFAULT_EDGE
  let notch: Notch | null = null
  let island: BrowserWindow | undefined
  let tray: Tray | undefined
  let sheet: BrowserWindow | undefined
  let waiting = 0
  /** Where the island draws, on the screen; and whether the pointer is on it. */
  let drawn: Rectangle | null = null
  let pointed = false

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
    if (island !== undefined && !island.isDestroyed()) return island.setBounds(islandBounds(at))
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
    // Over the menu bar and its items, under a menu that opens later.
    made.setAlwaysOnTop(true, 'pop-up-menu')
    made.once('ready-to-show', () => made.showInactive())
    made.on('closed', () => {
      if (island === made) island = undefined
    })
    load(made, { place: 'island', notchWidth: String(Math.round(at.width)), notchHeight: String(Math.round(at.height)) })
    island = made
  }

  const dropIsland = () => {
    island?.destroy()
    island = undefined
    drawn = null
    pointed = false
  }

  /* Clicks land on the island while the pointer is on what it draws, and go through elsewhere; the page hears which, to open and close. */
  const watch = setInterval(() => {
    if (island === undefined || island.isDestroyed() || drawn === null) return
    const { x, y } = screen.getCursorScreenPoint()
    const on = x >= drawn.x && x < drawn.x + drawn.width && y >= drawn.y && y < drawn.y + drawn.height
    if (on === pointed) return
    pointed = on
    island.setIgnoreMouseEvents(!on, { forward: true })
    island.webContents.send('althar:edge-pointed', on)
  }, POINTER)
  watch.unref?.()

  /* ---- the menu bar ---- */

  const picture = (yours: boolean) => {
    const image = nativeImage.createFromPath(join(host.pictures, yours ? 'markYoursTemplate.png' : 'markTemplate.png'))
    // The menu bar draws a template in its own colour, light or dark, whatever is behind it.
    image.setTemplateImage(true)
    return image
  }

  /** Under the mark, kept on its screen; on the screen's top right where the system can't say where the mark is. */
  const sheetPlace = (height: number) => {
    const mark = tray?.getBounds()
    const known = mark !== undefined && mark.width > 0
    const point = known ? { x: mark.x + mark.width / 2, y: mark.y + mark.height } : screen.getCursorScreenPoint()
    const { workArea } = screen.getDisplayNearestPoint(point)
    const x = known ? point.x - SHEET.width / 2 : workArea.x + workArea.width - SHEET.width
    return {
      x: Math.round(Math.min(Math.max(x, workArea.x + SHEET.gap), workArea.x + workArea.width - SHEET.width - SHEET.gap)),
      // Just under the menu bar: where the system says the mark is may be off on a second screen.
      y: workArea.y + SHEET.gap,
      width: SHEET.width,
      height: Math.min(height, workArea.height - 2 * SHEET.gap),
    }
  }

  const makeSheet = (): BrowserWindow => {
    const made = new BrowserWindow({
      ...shared(host.preload),
      ...sheetPlace(SHEET.height),
      // Paper, with the system's own corners and shadow, as a menu has.
      backgroundColor: '#fcfbf8',
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
    // Made now and kept hidden, so the first click opens it at once, already read.
    makeSheet()
  }

  const dropTray = () => {
    tray?.destroy()
    tray = undefined
    sheet?.destroy()
    sheet = undefined
  }

  /* ---- which, and where ---- */

  const apply = () => {
    if (edgeIn(chosen, notch) === 'island' && notch !== null) {
      dropTray()
      showIsland(notch)
    } else {
      dropIsland()
      try {
        showTray()
      } catch {
        // Where the system has no menu bar to put it in (a desktop without a tray), there is no edge.
      }
    }
  }

  const look = async () => {
    notch = await findNotch(screen.getPrimaryDisplay().bounds.height)
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

  void readEdge(host.profile()).then((place) => {
    chosen = place
    return look()
  })

  return {
    state: () => ({ place: chosen, notch: notch !== null }),
    choose: async (place) => {
      chosen = place
      apply()
      await writeEdge(host.profile(), place)
    },
    waiting: (count) => {
      waiting = count
      if (tray !== undefined && !tray.isDestroyed()) tray.setImage(picture(count > 0))
    },
    owns: (window) => window === island || window === sheet,
    drawn: (window, rect) => {
      if (window !== island) return
      const at = window.getBounds()
      drawn = { x: at.x + rect.x, y: at.y + rect.y, width: rect.width, height: rect.height }
    },
    sized: (window, height) => {
      if (window !== sheet || !Number.isFinite(height) || height <= 0) return
      const place = sheetPlace(Math.ceil(height))
      window.setBounds(window.isVisible() ? { ...window.getBounds(), height: place.height } : place)
    },
    settle: () => sheet?.hide(),
  }
}
