import { type ChildProcess, execFile, spawn } from 'node:child_process'

/** The XDG Settings portal's `org.freedesktop.appearance` `color-scheme`: 0 is no preference, 1 dark, 2 light. */
export type Scheme = 0 | 1 | 2

const PORTAL = ['--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop']

/** The scheme in what gdbus prints for a read, `(<<uint32 1>>,)`, or for the change signal; nothing where it names no scheme. */
export const parseScheme = (text: string): Scheme | undefined => {
  const value = /uint32 ([012])\b/.exec(text)?.[1]
  return value === undefined ? undefined : (Number(value) as Scheme)
}

/** Whether a line of `gdbus monitor` is the portal's change of the colour scheme: this setting's namespace and key, exactly. */
export const isSchemeChange = (line: string): boolean =>
  line.includes('SettingChanged') && line.includes("'org.freedesktop.appearance', 'color-scheme'")

/** How long to wait before starting the monitor again after it ended `failures` times in a row: a second, doubling, at most a minute. */
export const restartAfter = (failures: number): number => Math.min(60_000, 1000 * 2 ** failures)

/** Whether the panel is dark. Chromium cannot say on Linux, and most panels are dark: light only where the desktop says light. */
export const darkPanel = (scheme: Scheme | undefined): boolean => scheme !== 2

/**
 * Follows the desktop's light/dark setting through the Settings portal, which a Flatpak sandbox can reach and Electron's own
 * nativeTheme does not report on Linux. Calls `changed` with each scheme it learns; `undefined` where there is no portal.
 * Needs gdbus (in the Flatpak runtime); without it nothing is reported and the caller's default stands.
 */
export const watchColorScheme = (changed: (scheme: Scheme | undefined) => void): (() => void) => {
  let monitor: ChildProcess | undefined
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
      ['call', ...PORTAL, '--method', 'org.freedesktop.portal.Settings.ReadOne', 'org.freedesktop.appearance', 'color-scheme'],
      { timeout: 5000 },
      (error, out) => {
        if (!stopped && !heard && mine === latest) changed(error === null ? parseScheme(out) : undefined)
      },
    )
  }
  // The monitor is a child that can end (the bus restarts, gdbus is killed): it is started again after a pause that grows, and
  // the snapshot is read again once it speaks, as a change in the gap would be missed.
  let failures = 0
  let restart: NodeJS.Timeout | undefined
  const listen = () => {
    let child: ChildProcess
    try {
      child = spawn('gdbus', ['monitor', ...PORTAL], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      // No gdbus: the default stands.
      return
    }
    monitor = child
    let pending = ''
    let gone = false
    const started = Date.now()
    child.stdout?.on('data', (chunk: Buffer) => {
      snapshot(true)
      const lines = (pending + chunk.toString()).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!isSchemeChange(line)) continue
        const scheme = parseScheme(line)
        if (scheme === undefined || stopped) continue
        heard = true
        changed(scheme)
      }
    })
    const ended = () => {
      if (gone) return
      gone = true
      if (stopped) return
      // Only a monitor that stayed up a while was a working one: a banner and an exit is a failure, and the pause grows.
      if (Date.now() - started > 30_000) failures = 0
      snapshot(false)
      confirmed = false
      heard = false
      restart = setTimeout(listen, restartAfter(failures++))
      restart.unref()
    }
    child.on('error', ended)
    child.on('close', ended)
    child.unref()
  }
  listen()

  const timer = setTimeout(() => snapshot(false), 1000)
  timer.unref()

  return () => {
    stopped = true
    clearTimeout(timer)
    clearTimeout(restart)
    monitor?.kill()
  }
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
