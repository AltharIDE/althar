import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'

import { watchPortalSetting } from './colorScheme'
import {
  type ButtonLayout,
  cosmicLayout,
  decideFor,
  defaultLayout,
  type DesktopChrome,
  type DesktopFacts,
  factsFromEnv,
  kdeFacts,
  kwinDoubleClickMaximizes,
  kwinLayout,
  type LayoutSource,
  layoutSource,
  parseGnomeLayout,
  parseGsettingsDoubleClick,
  parseIni,
  parseLabwcLayout,
  parseOpenboxLayout,
  parsePortalAccent,
  parseQuoted,
  parseShellVersion,
  parseThemeName,
  parseXfwmDoubleClick,
  parseXfwmLayout,
  parseXpropMoves,
  parseXpropName,
  parseXpropOlderWm,
  parseXpropWindow,
  type Rgb,
  wayfireLayout,
  withFacts,
  wmFromName,
} from './desktop'

/*
 * What the desktop says of the window's dress, read for every window and
 * followed where the desktop signals a change (ADR-098). Every read is
 * read-only, short and safe where there is no desktop at all: the
 * environment; the Settings portal through gdbus, which a Flatpak reaches
 * too (GNOME's button layout and GTK theme, the accent), followed through
 * its SettingChanged, with gsettings for the layout where the portal
 * doesn't give it; each other desktop's button layout where it keeps it
 * (Cinnamon's and MATE's in gsettings; KWin's, Xfwm4's, Openbox's,
 * labwc's, Wayfire's and COSMIC's in their files, read as text through the
 * XDG cascade); KDE's decoration and colours from its files; GNOME Shell's
 * version from its D-Bus property; and on X11 the window manager's own
 * name and whether it moves windows, from xprop. No desktop program is ever run:
 * plasmashell, kreadconfig6 and their kind are GUI programs that abort
 * without a display, and kreadconfig6 opens a dialog where it can't write
 * its own config. What can't be read is unknown, and the desktop's default
 * stands. The layout's reads are local and quick, and the first window waits
 * for them (within FIRST_CHROME_WAIT). The slow reads (the version, the
 * window manager's name, KDE's decoration) don't hold it: what they found
 * last time is cached in the profile, and what they find now follows.
 */

/**
 * The only programs these reads run: gdbus, xprop and gsettings, command-line tools that open no window and need no display
 * (gsettings reads dconf's database: Cinnamon's and MATE's layouts, and GNOME's only where the portal doesn't give it).
 */
export const PROBES = ['gdbus', 'xprop', 'gsettings'] as const

/** How long a probe may take before it counts as unknown. */
export const PROBE_TIMEOUT = 2000

/** How long the first window waits for the desktop's first word: the portal answers in a blink, or not at all. */
export const FIRST_CHROME_WAIT = 1500

/**
 * How long the first window waits on X11 for xprop's word on the window manager, whatever it was told to wait for the rest: the
 * frame hangs on it and can't change once the window is open. Its two stages, each killed at PROBE_TIMEOUT, and a little more.
 */
export const FIRST_X11_WAIT = 2 * PROBE_TIMEOUT + 500

/** What the slow reads found, kept for the next start, for the same desktop only. */
export interface CachedFacts {
  readonly desktop: string
  readonly facts: Partial<Pick<DesktopFacts, 'wm' | 'gnomeVersion' | 'kdeDecoration' | 'kdeColorScheme' | 'wmMoves'>>
}

/** What the desktop is read through: the system's, or a test's. */
export interface ChromeSources {
  readonly platform: string
  readonly env: Readonly<Record<string, string | undefined>>
  /** The person's home folder, for the config files where XDG_CONFIG_HOME isn't set. */
  readonly home: string
  /** A file's text; fails where it can't be read. */
  readonly readText: (path: string) => Promise<string>
  /** What one of PROBES prints; fails where it can't be run, fails, or takes longer than `timeout`. */
  readonly run: (command: (typeof PROBES)[number], args: readonly string[], timeout: number) => Promise<string>
  readonly watchPortal: typeof watchPortalSetting
  /** The accent off Linux, as Electron reads it (systemPreferences.getAccentColor), and its changes; absent where there is none. */
  readonly systemAccent?: () => Rgb | null
  readonly onSystemAccent?: (listener: () => void) => () => void
  /** What the slow reads found last time, and keeping what they found now; absent, nothing is kept. */
  readonly cache?: { readonly read: () => Promise<unknown>; readonly write: (cached: CachedFacts) => Promise<void> }
}

/** All that is known of the desktop now. */
export interface DesktopLook {
  readonly facts: DesktopFacts
  /** Each desktop's own button layout, by where it is kept, where it was read: GNOME's through the portal, KWin's from kwinrc, … */
  readonly layouts: Partial<Record<LayoutSource, ButtonLayout>>
  readonly accent: Rgb | null
}

export interface FollowedChrome {
  readonly current: () => DesktopLook
  /** Calls `listener` with each change, until the returned function is called. */
  readonly follow: (listener: (look: DesktopLook) => void) => () => void
  /**
   * Settles once the cache and the portal have had their first word, or after `within` ms; on X11, never before xprop's word on
   * the window manager (within FIRST_X11_WAIT), which the window's frame hangs on.
   */
  readonly first: (within: number) => Promise<DesktopLook>
  readonly stop: () => void
}

/**
 * What the window is told: the decision for a window framed or not, and the buttons in the order and on the side the desktop says:
 * its own setting where it was read, else its default.
 */
export const chromeOf = (look: DesktopLook, framed: boolean): DesktopChrome => {
  const decision = decideFor(look.facts, framed)
  const source = layoutSource(look.facts)
  const layout = (source === undefined ? undefined : look.layouts[source]) ?? defaultLayout(look.facts.family)
  return { ...decision, family: look.facts.family, layout, accent: look.accent }
}

/** Which desktop the cache is for: what the environment named it, so another session's findings are never taken for this one's. */
export const desktopKey = (facts: DesktopFacts, env: Readonly<Record<string, string | undefined>>): string =>
  [facts.platform, facts.session, facts.family, env.XDG_CURRENT_DESKTOP ?? '', env.DESKTOP_SESSION ?? ''].join('|')

const isCached = (value: unknown, desktop: string): value is CachedFacts => {
  if (typeof value !== 'object' || value === null) return false
  const { desktop: kept, facts } = value as Record<string, unknown>
  if (kept !== desktop || typeof facts !== 'object' || facts === null) return false
  const { wm, gnomeVersion, kdeDecoration, kdeColorScheme, wmMoves } = facts as Record<string, unknown>
  const text = (one: unknown) => one === undefined || (typeof one === 'string' && /^[\w .+@-]{1,80}$/.test(one))
  return (
    text(wm) &&
    text(kdeDecoration) &&
    text(kdeColorScheme) &&
    (gnomeVersion === undefined || Number.isInteger(gnomeVersion)) &&
    (wmMoves === undefined || typeof wmMoves === 'boolean')
  )
}

/**
 * The XDG cascade for one of a desktop's files (KDE's, Xfce's, Openbox's…): the person's own (XDG_CONFIG_HOME, else ~/.config) first, then each of
 * XDG_CONFIG_DIRS (else /etc/xdg). Linux paths, joined as POSIX's wherever this runs, as its tests run on Windows too.
 */
export const configCascade = (name: string, env: Readonly<Record<string, string | undefined>>, home: string): string[] => {
  const own = env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : posix.join(home, '.config')
  const system = (env.XDG_CONFIG_DIRS ?? '').split(':').filter((dir) => dir.startsWith('/'))
  return [own, ...(system.length > 0 ? system : ['/etc/xdg'])].map((dir) => posix.join(dir, name))
}

const SHELL = ['call', '--session', '--dest', 'org.gnome.Shell', '--object-path', '/org/gnome/Shell']

export const followDesktopChrome = (sources: ChromeSources): FollowedChrome => {
  const { env, home } = sources
  const base = factsFromEnv(sources.platform, env)
  const desktop = desktopKey(base, env)
  let look: DesktopLook = { facts: base, layouts: {}, accent: null }
  const listeners = new Set<(look: DesktopLook) => void>()
  const stops: Array<() => void> = []
  let stopped = false
  const linux = sources.platform === 'linux'

  // What the first window waits for: the cache, and the portal's first word on each setting it is asked.
  const waiting = new Set<string>(['cache'])
  const settledOnes = new Set<() => void>()
  const settle = (what: string) => {
    waiting.delete(what)
    for (const check of settledOnes) check()
  }
  const set = (next: Partial<DesktopLook>) => {
    if (stopped) return
    const was = JSON.stringify(look)
    look = { ...look, ...next }
    if (JSON.stringify(look) === was) return
    for (const listener of listeners) listener(look)
  }
  const learn = (more: Parameters<typeof withFacts>[1]) => set({ facts: withFacts(look.facts, more) })

  // ---- the portal, followed ----
  const portal = <T>(
    name: string,
    namespace: string,
    key: string,
    parse: (text: string) => T | undefined,
    use: (value: T | undefined) => void,
  ) => {
    waiting.add(name)
    let first = true
    stops.push(
      sources.watchPortal(namespace, key, parse, (value) => {
        use(value)
        if (first) settle(name)
        first = false
      }),
    )
  }
  const probe = (command: (typeof PROBES)[number], args: readonly string[]) =>
    sources.run(command, args, PROBE_TIMEOUT).catch(() => undefined)
  // A `button-layout` key in GNOME's form, from gsettings, which prints a string quoted (`'appmenu:close'`): anything else isn't its answer.
  const gsettingsLayout = async (schema: string) => {
    const out = await probe('gsettings', ['get', schema, 'button-layout'])
    return out === undefined || parseQuoted(out) === undefined ? undefined : parseGnomeLayout(out)
  }
  // Each file of a desktop's through the XDG cascade, read once however many reads want it: the texts found, the person's first.
  const texts = new Map<string, Promise<string[]>>()
  const cascadeTexts = (name: string) => {
    let read = texts.get(name)
    if (read === undefined) {
      read = Promise.all(configCascade(name, env, home).map((path) => sources.readText(path).catch(() => undefined))).then((all) =>
        all.filter((text): text is string => text !== undefined),
      )
      texts.set(name, read)
    }
    return read
  }
  const cascadeInis = async (name: string) => (await cascadeTexts(name)).map(parseIni)
  // The first of the files, in order, whose text says what is asked.
  const firstIn = async <T>(names: readonly string[], parse: (text: string) => T | undefined) => {
    for (const name of names)
      for (const text of await cascadeTexts(name)) {
        const layout = parse(text)
        if (layout !== undefined) return layout
      }
    return undefined
  }
  const firstText = async (name: string) => (await cascadeTexts(name))[0]
  // Where each desktop but GNOME keeps its window buttons' layout (GNOME's is the portal's, above).
  const openboxFiles = base.family === 'lxde' ? ['openbox/lxde-rc.xml'] : base.family === 'lxqt' ? ['openbox/lxqt-rc.xml'] : []
  const readers: Readonly<Record<Exclude<LayoutSource, 'gnome'>, () => Promise<ButtonLayout | undefined>>> = {
    kwin: async () => kwinLayout(await cascadeInis('kwinrc')),
    cinnamon: () => gsettingsLayout('org.cinnamon.desktop.wm.preferences'),
    marco: () => gsettingsLayout('org.mate.Marco.general'),
    xfwm4: () => firstIn([xfwmFile], parseXfwmLayout),
    openbox: () => firstIn([...openboxFiles, 'openbox/rc.xml'], parseOpenboxLayout),
    labwc: () => firstIn(['labwc/rc.xml'], parseLabwcLayout),
    wayfire: async () => wayfireLayout(await cascadeInis('wayfire.ini')),
    cosmic: async () =>
      cosmicLayout(
        await firstText('cosmic/com.system76.CosmicTk/v1/show_minimize'),
        await firstText('cosmic/com.system76.CosmicTk/v1/show_maximize'),
      ),
  }
  // Whether a double-click on the title bar maximizes, where the window manager keeps it beside its layout. GNOME's key is the one
  // Chromium itself follows, so it is never against it; the others are their window manager's own.
  const xfwmFile = 'xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml'
  const gsettingsDoubleClick = async (schema: string) => {
    const out = await probe('gsettings', ['get', schema, 'action-double-click-titlebar'])
    return out === undefined ? undefined : parseGsettingsDoubleClick(out)
  }
  const clickReaders: Partial<Record<LayoutSource, () => Promise<boolean | undefined>>> = {
    kwin: async () => kwinDoubleClickMaximizes(await cascadeInis('kwinrc')),
    xfwm4: () => firstIn([xfwmFile], parseXfwmDoubleClick),
    marco: () => gsettingsDoubleClick('org.mate.Marco.general'),
    cinnamon: () => gsettingsDoubleClick('org.cinnamon.desktop.wm.preferences'),
  }
  const clicks: Partial<Record<LayoutSource, boolean>> = {}
  // The facts with the double-click of the window manager now known, and nothing of another's.
  const withClick = (facts: DesktopFacts): DesktopFacts => {
    const source = layoutSource(facts)
    const { doubleClickMaximizes: _was, ...rest } = facts
    const now = source === undefined ? undefined : clicks[source]
    return now === undefined ? rest : { ...rest, doubleClickMaximizes: now }
  }
  // The layout of the desktop as now known, read once per place, the first window waiting for it; called again as the window
  // manager comes to be known (from the cache, or from X11), since that may say it is kept elsewhere.
  const started = new Set<LayoutSource>()
  const readLayout = (facts: DesktopFacts) => {
    const source = layoutSource(facts)
    if (source === undefined || source === 'gnome' || started.has(source)) return
    started.add(source)
    const what = `layout:${source}`
    waiting.add(what)
    void readers[source]()
      .catch(() => undefined)
      .then((layout) => {
        if (layout !== undefined) set({ layouts: { ...look.layouts, [source]: layout } })
        settle(what)
      })
    const clickReader = clickReaders[source]
    if (clickReader === undefined) return
    const click = `click:${source}`
    waiting.add(click)
    void clickReader()
      .catch(() => undefined)
      .then((maximizes) => {
        if (maximizes !== undefined) clicks[source] = maximizes
        set({ facts: withClick(look.facts) })
        settle(click)
      })
  }
  if (linux) {
    // GNOME's button layout, followed through the portal. Where the portal doesn't give it (none running, or one that doesn't
    // expose the key), it is read once from gsettings, and the first window waits for that too; a change then shows next launch.
    // Only where the windows take GNOME's key: the other desktops keep theirs elsewhere (KDE's in kwinrc, Xfce's in xfconf).
    const gnomeKey = layoutSource(base) === 'gnome'
    waiting.add('layout')
    let firstLayout = true
    stops.push(
      sources.watchPortal('org.gnome.desktop.wm.preferences', 'button-layout', parseGnomeLayout, (layout) => {
        if (layout !== undefined) set({ layouts: { ...look.layouts, gnome: layout } })
        if (!firstLayout) return
        firstLayout = false
        if (layout !== undefined || !gnomeKey) return settle('layout')
        void gsettingsLayout('org.gnome.desktop.wm.preferences').then((read) => {
          // The portal may have spoken since; its word, followed live, wins.
          if (read !== undefined && look.layouts.gnome === undefined) set({ layouts: { ...look.layouts, gnome: read } })
          settle('layout')
        })
      }),
    )
    portal('theme', 'org.gnome.desktop.interface', 'gtk-theme', parseThemeName, (theme) => {
      if (theme !== undefined) learn({ gtkTheme: theme })
    })
    portal('accent', 'org.freedesktop.appearance', 'accent-color', parsePortalAccent, (accent) => set({ accent: accent ?? null }))
  } else if (sources.systemAccent !== undefined) {
    const read = sources.systemAccent
    const readNow = () => {
      try {
        set({ accent: read() })
      } catch {
        set({ accent: null })
      }
    }
    readNow()
    if (sources.onSystemAccent !== undefined) stops.push(sources.onSystemAccent(readNow))
  }

  // ---- the cache, then the slow reads ----
  const found: Mutable<CachedFacts['facts']> = {}
  const cacheRead = sources.cache === undefined ? Promise.resolve(undefined) : sources.cache.read().catch(() => undefined)
  if (linux) readLayout(base)
  void cacheRead.then((kept) => {
    if (isCached(kept, desktop)) set({ facts: withClick(withFacts(look.facts, kept.facts)) })
    if (linux) readLayout(look.facts)
    settle('cache')
  })
  const reads: Array<Promise<unknown>> = []
  // On X11, the window manager's name and whether it moves a frameless window. The first window waits for it, as its frame hangs
  // on it and can't change once it is open; xprop answers a live display at once. Undefined where xprop couldn't ask.
  const probeX11 = async (): Promise<Pick<DesktopFacts, 'wm' | 'wmMoves'> | undefined> => {
    const checked = await probe('xprop', ['-root', '-notype', '_NET_SUPPORTING_WM_CHECK'])
    if (checked === undefined) return undefined
    const id = parseXpropWindow(checked)
    // No window manager that says so by EWMH: one from before it, by its marks on the root window, or none.
    if (id === undefined) {
      const root = await probe('xprop', ['-root', '-notype'])
      return root === undefined ? undefined : { wmMoves: parseXpropOlderWm(root) }
    }
    const [named, supported] = await Promise.all([
      probe('xprop', ['-id', id, '-notype', '_NET_WM_NAME']),
      probe('xprop', ['-root', '-notype', '_NET_SUPPORTED']),
    ])
    const name = parseXpropName(named ?? '')
    return { wm: name === undefined ? undefined : wmFromName(name), wmMoves: parseXpropMoves(supported ?? '') }
  }
  if (linux && base.session === 'x11') {
    waiting.add('x11')
    reads.push(
      (async () => {
        const x11 = await probeX11()
        // After the cache, whose word on this window manager it replaces: what was found last time may be another's.
        await cacheRead
        if (x11 === undefined || stopped) return
        if (x11.wm !== undefined) found.wm = x11.wm
        if (x11.wmMoves !== undefined) found.wmMoves = x11.wmMoves
        const { wm: _wm, wmMoves: _moves, ...rest } = look.facts
        set({ facts: withClick(withFacts({ ...rest, family: base.family }, x11)) })
        readLayout(look.facts)
      })().finally(() => settle('x11')),
    )
  }
  if (linux && base.family === 'gnome') {
    reads.push(
      probe('gdbus', [...SHELL, '--method', 'org.freedesktop.DBus.Properties.Get', 'org.gnome.Shell', 'ShellVersion']).then((out) => {
        const version = out === undefined ? undefined : parseShellVersion(out)
        if (version !== undefined) found.gnomeVersion = version
      }),
    )
  }
  if (linux && (base.family === 'kde' || base.family === 'lxqt' || base.family === 'deepin' || base.wm === 'kwin')) {
    reads.push(
      Promise.all([cascadeInis('kwinrc'), cascadeInis('kdeglobals')]).then(([kwinrc, kdeglobals]) => {
        Object.assign(found, kdeFacts(kwinrc, kdeglobals))
      }),
    )
  }
  // Once the cache is read, so a slower read never loses to what it held; then kept for the next start.
  void Promise.all([cacheRead, ...reads]).then(() => {
    if (stopped) return
    learn(found)
    if (sources.cache !== undefined && reads.length > 0) void sources.cache.write({ desktop, facts: found }).catch(() => undefined)
  })

  return {
    current: () => look,
    follow: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    first: (within) =>
      new Promise((resolve) => {
        if (waiting.size === 0) return resolve(look)
        let late = false
        const done = () => {
          clearTimeout(timer)
          clearTimeout(cap)
          settledOnes.delete(check)
          resolve(look)
        }
        // Past `within`, only xprop's word is waited for.
        const check = () => {
          if (waiting.size === 0 || (late && !waiting.has('x11'))) done()
        }
        const timer = setTimeout(() => {
          late = true
          check()
        }, within)
        const cap = setTimeout(done, Math.max(within, FIRST_X11_WAIT))
        settledOnes.add(check)
      }),
    stop: () => {
      stopped = true
      for (const stop of stops) stop()
      listeners.clear()
    },
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** The cache's file in the profile. */
export const CHROME_CACHE = 'window-chrome.json'

/** The system's own sources; the accent off Linux comes from Electron, which main.ts gives. */
export const systemSources = (
  options: Pick<ChromeSources, 'platform' | 'env' | 'home' | 'systemAccent' | 'onSystemAccent'> & { readonly profile?: string },
): ChromeSources => {
  const { profile, ...rest } = options
  return {
    ...rest,
    readText: (path) => readFile(path, 'utf8'),
    run: (command, args, timeout) =>
      new Promise((resolve, reject) => {
        // Only the probes, never a desktop program (see above); with no shell, and killed when it takes too long.
        if (!PROBES.includes(command)) return reject(new Error(`${command} is not a probe`))
        execFile(command, [...args], { timeout, windowsHide: true, killSignal: 'SIGKILL' }, (error, out) =>
          error === null ? resolve(out) : reject(error),
        )
      }),
    watchPortal: watchPortalSetting,
    ...(profile === undefined
      ? {}
      : {
          cache: {
            read: async () => JSON.parse(await readFile(join(profile, CHROME_CACHE), 'utf8')) as unknown,
            write: async (cached) => {
              await mkdir(profile, { recursive: true })
              const temporary = join(profile, `${CHROME_CACHE}.${process.pid}.tmp`)
              await writeFile(temporary, JSON.stringify(cached))
              await rename(temporary, join(profile, CHROME_CACHE))
            },
          },
        }),
  }
}
