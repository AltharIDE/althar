import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { watchPortalSetting } from './colorScheme'
import {
  type ButtonLayout,
  decideFor,
  defaultLayout,
  type DesktopChrome,
  type DesktopFacts,
  factsFromEnv,
  type Ini,
  kdeFacts,
  kwinLayout,
  parseGnomeLayout,
  parseIni,
  parsePortalAccent,
  parseQuoted,
  parseShellVersion,
  parseThemeName,
  parseXpropName,
  parseXpropWindow,
  type Rgb,
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
 * doesn't give it; KDE's own files, read as text through the XDG
 * cascade; GNOME Shell's version from its D-Bus property; and on X11 the
 * window manager's own name, from xprop. No desktop program is ever run:
 * plasmashell, kreadconfig6 and their kind are GUI programs that abort
 * without a display, and kreadconfig6 opens a dialog where it can't write
 * its own config. What can't be read is unknown, and the desktop's default
 * stands. The slow reads (the version, the window manager's name, KDE's
 * files) don't hold the first window: what they found last time is cached
 * in the profile, and what they find now follows.
 */

/**
 * The only programs these reads run: gdbus, xprop and gsettings, command-line tools that open no window and need no display
 * (gsettings reads dconf's database, and only where the portal doesn't give GNOME's button layout).
 */
export const PROBES = ['gdbus', 'xprop', 'gsettings'] as const

/** How long a probe may take before it counts as unknown. */
export const PROBE_TIMEOUT = 2000

/** How long the first window waits for the desktop's first word: the portal answers in a blink, or not at all. */
export const FIRST_CHROME_WAIT = 1500

/** What the slow reads found, kept for the next start, for the same desktop only. */
export interface CachedFacts {
  readonly desktop: string
  readonly facts: Partial<Pick<DesktopFacts, 'wm' | 'gnomeVersion' | 'kdeDecoration' | 'kdeColorScheme'>>
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
  /** GNOME's `button-layout`, through the portal, where it said. */
  readonly gnomeLayout?: ButtonLayout
  /** KDE's buttons, from kwinrc's cascade, where it was read. */
  readonly kdeLayout?: ButtonLayout
  readonly accent: Rgb | null
}

export interface FollowedChrome {
  readonly current: () => DesktopLook
  /** Calls `listener` with each change, until the returned function is called. */
  readonly follow: (listener: (look: DesktopLook) => void) => () => void
  /** Settles once the cache and the portal have had their first word, or after `within` ms. */
  readonly first: (within: number) => Promise<DesktopLook>
  readonly stop: () => void
}

/** What the window is told: the decision for a window framed or not, and the buttons in the order and on the side the desktop says. */
export const chromeOf = (look: DesktopLook, framed: boolean): DesktopChrome => {
  const decision = decideFor(look.facts, framed)
  const layout =
    decision.look === 'gnome'
      ? (look.gnomeLayout ?? defaultLayout(look.facts.family))
      : decision.look === 'kde'
        ? (look.kdeLayout ?? defaultLayout(look.facts.family))
        : defaultLayout(look.facts.family)
  return { ...decision, family: look.facts.family, layout, accent: look.accent }
}

/** Which desktop the cache is for: what the environment named it, so another session's findings are never taken for this one's. */
export const desktopKey = (facts: DesktopFacts, env: Readonly<Record<string, string | undefined>>): string =>
  [facts.platform, facts.session, facts.family, env.XDG_CURRENT_DESKTOP ?? '', env.DESKTOP_SESSION ?? ''].join('|')

const isCached = (value: unknown, desktop: string): value is CachedFacts => {
  if (typeof value !== 'object' || value === null) return false
  const { desktop: kept, facts } = value as Record<string, unknown>
  if (kept !== desktop || typeof facts !== 'object' || facts === null) return false
  const { wm, gnomeVersion, kdeDecoration, kdeColorScheme } = facts as Record<string, unknown>
  const text = (one: unknown) => one === undefined || (typeof one === 'string' && /^[\w .+@-]{1,80}$/.test(one))
  return text(wm) && text(kdeDecoration) && text(kdeColorScheme) && (gnomeVersion === undefined || Number.isInteger(gnomeVersion))
}

/** The XDG cascade for one of KDE's files: the person's own (XDG_CONFIG_HOME, else ~/.config) first, then each of XDG_CONFIG_DIRS (else /etc/xdg). */
export const configCascade = (name: string, env: Readonly<Record<string, string | undefined>>, home: string): string[] => {
  const own = env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(home, '.config')
  const system = (env.XDG_CONFIG_DIRS ?? '').split(':').filter((dir) => dir.startsWith('/'))
  return [own, ...(system.length > 0 ? system : ['/etc/xdg'])].map((dir) => join(dir, name))
}

const SHELL = ['call', '--session', '--dest', 'org.gnome.Shell', '--object-path', '/org/gnome/Shell']

export const followDesktopChrome = (sources: ChromeSources): FollowedChrome => {
  const { env, home } = sources
  const base = factsFromEnv(sources.platform, env)
  const desktop = desktopKey(base, env)
  let look: DesktopLook = { facts: base, accent: null }
  const listeners = new Set<(look: DesktopLook) => void>()
  const stops: Array<() => void> = []
  let stopped = false
  const linux = sources.platform === 'linux'

  // What the first window waits for: the cache, and the portal's first word on each setting it is asked.
  const waiting = new Set<string>(['cache'])
  const settledOnes = new Set<() => void>()
  const settle = (what: string) => {
    waiting.delete(what)
    if (waiting.size === 0) for (const done of settledOnes) done()
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
  if (linux) {
    // GNOME's button layout, followed through the portal. Where the portal doesn't give it (none running, or one that doesn't
    // expose the key), it is read once from gsettings, and the first window waits for that too; a change then shows next launch.
    // Only on the desktops whose windows take GNOME's key: the others keep theirs elsewhere (KDE's in kwinrc), or draw a frame.
    const gnomeKey = base.family === 'gnome' || base.family === 'budgie' || base.family === 'pantheon' || base.family === 'unity'
    waiting.add('layout')
    let firstLayout = true
    stops.push(
      sources.watchPortal('org.gnome.desktop.wm.preferences', 'button-layout', parseGnomeLayout, (layout) => {
        if (layout !== undefined) set({ gnomeLayout: layout })
        if (!firstLayout) return
        firstLayout = false
        if (layout !== undefined || !gnomeKey) return settle('layout')
        void probe('gsettings', ['get', 'org.gnome.desktop.wm.preferences', 'button-layout']).then((out) => {
          // gsettings prints a string quoted, `'appmenu:close'`; anything else isn't its answer.
          const read = out === undefined || parseQuoted(out) === undefined ? undefined : parseGnomeLayout(out)
          // The portal may have spoken since; its word, followed live, wins.
          if (read !== undefined && look.gnomeLayout === undefined) set({ gnomeLayout: read })
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
  void cacheRead.then((kept) => {
    if (isCached(kept, desktop)) learn(kept.facts)
    settle('cache')
  })
  const reads: Array<Promise<unknown>> = []
  if (linux && base.session === 'x11') {
    reads.push(
      (async () => {
        const id = parseXpropWindow((await probe('xprop', ['-root', '-notype', '_NET_SUPPORTING_WM_CHECK'])) ?? '')
        if (id === undefined) return
        const name = parseXpropName((await probe('xprop', ['-id', id, '-notype', '_NET_WM_NAME'])) ?? '')
        const wm = name === undefined ? undefined : wmFromName(name)
        if (wm !== undefined) found.wm = wm
      })(),
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
    const cascade = (name: string) =>
      Promise.all(
        configCascade(name, env, home).map((path) =>
          sources
            .readText(path)
            .then(parseIni)
            .catch((): Ini => new Map()),
        ),
      )
    reads.push(
      Promise.all([cascade('kwinrc'), cascade('kdeglobals')]).then(([kwinrc, kdeglobals]) => {
        Object.assign(found, kdeFacts(kwinrc, kdeglobals))
        set({ kdeLayout: kwinLayout(kwinrc) })
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
        const done = () => {
          clearTimeout(timer)
          settledOnes.delete(done)
          resolve(look)
        }
        const timer = setTimeout(done, within)
        settledOnes.add(done)
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
