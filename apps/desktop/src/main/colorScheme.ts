import { type ChildProcess, execFile, spawn } from 'node:child_process'

import type { Appearance } from './appPreferences'

/** The XDG Settings portal's `org.freedesktop.appearance` `color-scheme`: 0 is no preference, 1 dark, 2 light. */
export type Scheme = 0 | 1 | 2

const PORTAL = ['--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop']

/** The scheme in what gdbus prints for a read, `(<<uint32 1>>,)`, or for the change signal; nothing where it names no scheme. */
export const parseScheme = (text: string): Scheme | undefined => {
  const value = /uint32 ([012])\b/.exec(text)?.[1]
  return value === undefined ? undefined : (Number(value) as Scheme)
}

/** Whether a line of `gdbus monitor` is the portal's change of one setting: its namespace and key, exactly. */
export const isSettingChange = (line: string, namespace: string, key: string): boolean =>
  line.includes('SettingChanged') && line.includes(`'${namespace}', '${key}'`)

/** Whether a line of `gdbus monitor` is the portal's change of the colour scheme: this setting's namespace and key, exactly. */
export const isSchemeChange = (line: string): boolean => isSettingChange(line, 'org.freedesktop.appearance', 'color-scheme')

/** How long to wait before starting the monitor again after it ended `failures` times in a row: a second, doubling, at most a minute. */
export const restartAfter = (failures: number): number => Math.min(60_000, 1000 * 2 ** failures)

/** Whether the panel is dark. Chromium cannot say on Linux, and most panels are dark: light only where the desktop says light. */
export const darkPanel = (scheme: Scheme | undefined): boolean => scheme !== 2

/** One setting followed through the shared monitor: how it is read, who hears it, and where its own snapshot stands. */
interface Follower {
  readonly namespace: string
  readonly key: string
  readonly read: (text: string) => void
  readonly snapshot: (afterSubscribing: boolean) => void
  /** The monitor ended: the next snapshot isn't final, and a change heard before no longer outranks it. */
  readonly lost: () => void
}

/**
 * The Settings portal watched once for every setting followed (the scheme, the accent, GNOME's button layout and theme): one
 * `gdbus monitor` child, started with the first follower and ended with the last, started again after a pause that grows if
 * it ends while anyone follows (the bus restarts, gdbus is killed).
 */
const portalMonitor = (() => {
  const followers = new Set<Follower>()
  let monitor: ChildProcess | undefined
  let restart: NodeJS.Timeout | undefined
  let failures = 0
  const listen = () => {
    restart = undefined
    let child: ChildProcess
    try {
      child = spawn('gdbus', ['monitor', ...PORTAL], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      // No gdbus: each follower's default stands.
      return
    }
    monitor = child
    let pending = ''
    let gone = false
    const started = Date.now()
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const follower of followers) follower.snapshot(true)
      const lines = (pending + chunk.toString()).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines)
        for (const follower of followers) {
          if (!isSettingChange(line, follower.namespace, follower.key)) continue
          // The signal's value is what follows the key.
          follower.read(line.slice(line.indexOf(`'${follower.key}'`) + follower.key.length + 2))
        }
    })
    const ended = () => {
      if (gone) return
      gone = true
      if (monitor !== child) return
      monitor = undefined
      if (followers.size === 0) return
      // Only a monitor that stayed up a while was a working one: a banner and an exit is a failure, and the pause grows.
      if (Date.now() - started > 30_000) failures = 0
      for (const follower of followers) {
        follower.snapshot(false)
        follower.lost()
      }
      restart = setTimeout(listen, restartAfter(failures++))
      restart.unref()
    }
    child.on('error', ended)
    child.on('close', ended)
    child.unref()
  }
  return (follower: Follower): (() => void) => {
    followers.add(follower)
    if (monitor === undefined && restart === undefined) listen()
    return () => {
      followers.delete(follower)
      if (followers.size > 0) return
      clearTimeout(restart)
      restart = undefined
      failures = 0
      const child = monitor
      monitor = undefined
      child?.kill()
    }
  }
})()

/**
 * Follows one of the Settings portal's settings, which a Flatpak sandbox can reach and Electron doesn't report on Linux: calls
 * `changed` with each value it learns, as `parse` reads what gdbus prints; `undefined` where the portal has none, or there is no
 * portal. Needs gdbus (in the Flatpak runtime too); without it nothing is reported and the caller's default stands.
 */
export const watchPortalSetting = <T>(
  namespace: string,
  key: string,
  parse: (text: string) => T | undefined,
  changed: (value: T | undefined) => void,
): (() => void) => {
  let stopped = false
  // A change the monitor reports is newer than the snapshot read after it: the snapshot never overwrites one.
  let heard = false
  // The snapshot is read once the monitor says it is listening (it prints a line then). A second without word reads it anyway,
  // for a gdbus that prints nothing, and the monitor's first word reads it again: that one is taken after the subscription, so
  // it is final, and the answer of an earlier read no longer counts.
  let latest = 0
  let confirmed = false
  const snapshot = (afterSubscribing: boolean) => {
    if (stopped || confirmed) return
    confirmed = afterSubscribing
    const mine = ++latest
    execFile(
      'gdbus',
      ['call', ...PORTAL, '--method', 'org.freedesktop.portal.Settings.ReadOne', namespace, key],
      { timeout: 5000 },
      (error, out) => {
        if (!stopped && !heard && mine === latest) changed(error === null ? parse(out) : undefined)
      },
    )
  }
  const leave = portalMonitor({
    namespace,
    key,
    snapshot,
    read: (text) => {
      const value = parse(text)
      if (value === undefined || stopped) return
      heard = true
      changed(value)
    },
    lost: () => {
      confirmed = false
      heard = false
    },
  })
  const timer = setTimeout(() => snapshot(false), 1000)
  timer.unref()
  return () => {
    stopped = true
    clearTimeout(timer)
    leave()
  }
}

/** Follows the desktop's light/dark setting through the Settings portal (`watchPortalSetting`). */
export const watchColorScheme = (changed: (scheme: Scheme | undefined) => void): (() => void) =>
  watchPortalSetting('org.freedesktop.appearance', 'color-scheme', parseScheme, changed)

/**
 * One watch of the desktop's scheme for everything that follows it (the windows' theme, the tray's mark), started with
 * the first who asks and stopped with the last; a late one hears the last scheme at once. `watch` is the watcher,
 * watchColorScheme where it isn't a test's.
 */
export const desktopScheme = (watch: typeof watchColorScheme = watchColorScheme) => {
  const listeners = new Set<(scheme: Scheme | undefined) => void>()
  let stop: (() => void) | undefined
  let heard = false
  let last: Scheme | undefined
  return (listener: (scheme: Scheme | undefined) => void): (() => void) => {
    listeners.add(listener)
    if (heard) listener(last)
    stop ??= watch((scheme) => {
      heard = true
      last = scheme
      for (const one of listeners) one(scheme)
    })
    return () => {
      listeners.delete(listener)
      if (listeners.size > 0 || stop === undefined) return
      stop()
      stop = undefined
      heard = false
    }
  }
}

/** The desktop's scheme, on Linux, watched once for all who follow it. */
export const followDesktopScheme = desktopScheme()

/** How long the first window waits for the desktop's first word on its scheme: the portal answers in a blink, or not at all. */
export const FIRST_SCHEME_WAIT = 1500

/**
 * The desktop's first word on its scheme, from `follow`, or nothing once `within` ms pass without one (no portal, or
 * one too slow): what the first window waits for on Linux while Appearance is as the system is, so it opens dark on a
 * dark desktop rather than light and then dark.
 */
export const firstScheme = (
  follow: (listener: (scheme: Scheme | undefined) => void) => () => void,
  within: number,
): Promise<Scheme | undefined> =>
  new Promise((resolve) => {
    let done = false
    let leave: (() => void) | undefined
    const finish = (scheme: Scheme | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      leave?.()
      resolve(scheme)
    }
    const timer = setTimeout(() => finish(undefined), within)
    leave = follow(finish)
    // told at once, as a late listener is: it left before it knew how
    if (done) leave()
  })

/**
 * What Electron's nativeTheme should follow for Settings › Appearance. Light and dark are themselves. As the system is,
 * a Mac's and Windows' own setting is what nativeTheme already follows; Linux's isn't, where Electron has no word from
 * the desktop, so the Settings portal's says it: dark or light where it names one, Chromium's own guess where it doesn't.
 */
export const themeSourceFor = (appearance: Appearance, platform: NodeJS.Platform, scheme: Scheme | undefined): Appearance => {
  if (appearance !== 'system' || platform !== 'linux') return appearance
  return scheme === 1 ? 'dark' : scheme === 2 ? 'light' : 'system'
}

const PERSONALIZE = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`

/** Whether the system (taskbar) theme is light, from `reg query … /v SystemUsesLightTheme`; nothing where the value is not there. */
export const parseSystemUsesLightTheme = (text: string): boolean | undefined => {
  const value = /SystemUsesLightTheme\s+REG_DWORD\s+(0x[0-9a-f]+)/i.exec(text)?.[1]
  return value === undefined ? undefined : Number(value) !== 0
}

/**
 * Reads whether the Windows taskbar is light. That is the system theme, `SystemUsesLightTheme`; the apps' theme
 * (nativeTheme.shouldUseDarkColors, `AppsUseLightTheme`) is another setting and may differ. `undefined` where it cannot be read.
 */
export const readSystemUsesLightTheme = (done: (light: boolean | undefined) => void): void => {
  execFile('reg', ['query', PERSONALIZE, '/v', 'SystemUsesLightTheme'], { timeout: 5000, windowsHide: true }, (error, out) => {
    done(error === null ? parseSystemUsesLightTheme(out) : undefined)
  })
}
