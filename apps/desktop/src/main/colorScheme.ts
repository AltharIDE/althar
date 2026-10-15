import { type ChildProcess, execFile, spawn } from 'node:child_process'

/** The XDG Settings portal's `org.freedesktop.appearance` `color-scheme`: 0 is no preference, 1 dark, 2 light. */
export type Scheme = 0 | 1 | 2

const PORTAL = ['--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop']

/** The scheme in what gdbus prints for a read, `(<<uint32 1>>,)`, or for the change signal; nothing where it names no scheme. */
export const parseScheme = (text: string): Scheme | undefined => {
  const value = /uint32 ([012])\b/.exec(text)?.[1]
  return value === undefined ? undefined : (Number(value) as Scheme)
}

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
  try {
    monitor = spawn('gdbus', ['monitor', ...PORTAL], { stdio: ['ignore', 'pipe', 'ignore'] })
    let pending = ''
    monitor.stdout?.on('data', (chunk: Buffer) => {
      snapshot(true)
      const lines = (pending + chunk.toString()).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.includes('SettingChanged') || !line.includes('color-scheme')) continue
        const scheme = parseScheme(line)
        if (scheme === undefined || stopped) continue
        heard = true
        changed(scheme)
      }
    })
    monitor.on('error', () => snapshot(false))
    monitor.unref()
  } catch {
    // No gdbus: the default stands.
  }

  const timer = setTimeout(() => snapshot(false), 1000)
  timer.unref()

  return () => {
    stopped = true
    clearTimeout(timer)
    monitor?.kill()
  }
}
