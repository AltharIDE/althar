import { type ChildProcess, spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/*
 * The display the end-to-end tests run on, on Linux: never the person's own. A run there would open the app's windows on
 * their desktop, and a display of its own, such as a nested Xwayland, shows up on it as a window too. So each run gets a
 * private one no one sees, as CI's does:
 *
 * - Xvfb, where it is installed: a virtual X display, on a number it picks free itself (-displayfd), stopped as the run ends.
 * - Otherwise Chromium's headless Ozone platform (`--ozone-platform=headless`, e2e/support.ts), which needs nothing
 *   installed: the app draws its windows in memory, so screenshots are real, and nothing reaches any display.
 * - The display it was given, where CI already wraps the run in xvfb-run, or where the person asks for it with
 *   ALTHAR_E2E_DISPLAY=inherit, to watch a run on their own desktop.
 *
 * ALTHAR_E2E_DISPLAY=xvfb or headless asks for one of them. macOS and Windows are left as they are.
 */

export type Display =
  | { readonly kind: 'untouched' }
  | { readonly kind: 'inherit'; readonly why: string }
  | { readonly kind: 'xvfb'; readonly program: string }
  | { readonly kind: 'headless' }
  | { readonly kind: 'fail'; readonly message: string }

type Env = Readonly<Record<string, string | undefined>>

export const XVFB_PACKAGES = 'Fedora: xorg-x11-server-Xvfb, Debian/Ubuntu: xvfb, Arch: xorg-server-xvfb'

/** Where `command` is on `path`, if it is. */
export const onPath = (command: string, path = process.env.PATH ?? ''): string | undefined => {
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue
    try {
      accessSync(join(dir, command), constants.X_OK)
      return join(dir, command)
    } catch {
      // Not here.
    }
  }
  return undefined
}

const set = (value: string | undefined) => value !== undefined && value !== ''

/** Which display a run on `platform` takes, given its environment and where Xvfb is (`find`). */
export const chooseDisplay = (platform: NodeJS.Platform, env: Env, find: (command: string) => string | undefined): Display => {
  if (platform !== 'linux') return { kind: 'untouched' }
  const asked = (env.ALTHAR_E2E_DISPLAY ?? '').trim().toLowerCase()
  if (asked === 'inherit') return { kind: 'inherit', why: 'ALTHAR_E2E_DISPLAY=inherit' }
  if (asked === 'headless') return { kind: 'headless' }
  const xvfb = find('Xvfb')
  if (asked === 'xvfb')
    return xvfb === undefined
      ? { kind: 'fail', message: `ALTHAR_E2E_DISPLAY=xvfb, but Xvfb isn't installed. Install it (${XVFB_PACKAGES}).` }
      : { kind: 'xvfb', program: xvfb }
  if (asked !== '') return { kind: 'fail', message: `ALTHAR_E2E_DISPLAY is inherit, xvfb or headless, not ${env.ALTHAR_E2E_DISPLAY}.` }
  // CI runs the tests under xvfb-run itself (.github/workflows): its display is already a virtual one.
  if (set(env.CI) && (set(env.DISPLAY) || set(env.WAYLAND_DISPLAY))) return { kind: 'inherit', why: "CI's own display" }
  return xvfb === undefined ? { kind: 'headless' } : { kind: 'xvfb', program: xvfb }
}

/** What Playwright and the app run with on `display`: none of the person's displays, only the one chosen. */
export const displayEnv = (display: Display, env: Env, x?: string): Record<string, string | undefined> => {
  if (display.kind !== 'xvfb' && display.kind !== 'headless') return { ...env }
  const {
    DISPLAY: _display,
    WAYLAND_DISPLAY: _wayland,
    XAUTHORITY: _auth,
    XDG_SESSION_TYPE: _session,
    ALTHAR_E2E_OZONE: _ozone,
    ...rest
  } = env
  return display.kind === 'xvfb' ? { ...rest, DISPLAY: x, XDG_SESSION_TYPE: 'x11' } : { ...rest, ALTHAR_E2E_OZONE: 'headless' }
}

export interface Running {
  readonly display: string
  readonly server: ChildProcess
  readonly stop: () => void
}

/** Starts Xvfb on a free display, which it picks and names on a pipe of its own; rejects if it doesn't say within `wait` ms. */
export const startXvfb = (program: string, wait = 10_000): Promise<Running> =>
  new Promise((resolve, reject) => {
    const server = spawn(program, ['-displayfd', '3', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
    })
    let said = ''
    let errors = ''
    const stop = () => {
      if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM')
    }
    const fail = (why: string) => {
      clearTimeout(timer)
      stop()
      reject(new Error(`Xvfb didn't start: ${why}${errors.trim() === '' ? '' : `\n${errors.trim()}`}`))
    }
    const timer = setTimeout(() => fail(`no display after ${wait} ms`), wait)
    server.stderr?.on('data', (chunk: Buffer) => (errors += chunk.toString()))
    server.once('error', (error) => fail(error.message))
    server.once('exit', (code, signal) => fail(`it exited (${signal ?? code})`))
    server.stdio[3]?.on('data', (chunk: Buffer) => {
      said += chunk.toString()
      const number = /^(\d+)\n/.exec(said)?.[1]
      if (number === undefined) return
      clearTimeout(timer)
      server.removeAllListeners('exit')
      resolve({ display: `:${number}`, server, stop })
    })
  })
