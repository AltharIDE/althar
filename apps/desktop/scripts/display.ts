import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

/*
 * The display the end-to-end tests run on, on Linux: never the person's own. A run there would open the app's windows on
 * their desktop, and a display of its own, such as a nested Xwayland, shows up on it as a window too. So each run gets a
 * private one no one sees, as CI's does:
 *
 * - Xvfb, where it is installed: a virtual X display, on a number it picks free itself (-displayfd), with a cookie only
 *   the run has, stopped as the run ends.
 * - Otherwise, or where Xvfb won't start, Chromium's headless Ozone platform (`--ozone-platform=headless`, e2e/support.ts),
 *   which needs nothing installed: the app draws its windows in memory, so screenshots are real, and nothing reaches any
 *   display.
 * - The display it was given with ALTHAR_E2E_DISPLAY=inherit: CI's workflows, which run the tests under xvfb-run, or a
 *   person who wants to watch a run on their own desktop.
 *
 * Either virtual one also runs off the person's session bus (displayEnv). ALTHAR_E2E_DISPLAY=xvfb or headless asks for one
 * of them. macOS and Windows are left as they are.
 */

export type Display =
  | { readonly kind: 'untouched' }
  | { readonly kind: 'inherit' }
  /** `asked`: by ALTHAR_E2E_DISPLAY=xvfb, so a server that won't start fails the run rather than leaving it headless. */
  | { readonly kind: 'xvfb'; readonly program: string; readonly asked: boolean }
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

/** Which display a run on `platform` takes, given its environment and where Xvfb is (`find`). */
export const chooseDisplay = (platform: NodeJS.Platform, env: Env, find: (command: string) => string | undefined): Display => {
  if (platform !== 'linux') return { kind: 'untouched' }
  const asked = (env.ALTHAR_E2E_DISPLAY ?? '').trim().toLowerCase()
  // CI's workflows that run the tests under xvfb-run say so with inherit: their display is already a virtual one.
  if (asked === 'inherit') return { kind: 'inherit' }
  if (asked === 'headless') return { kind: 'headless' }
  const xvfb = find('Xvfb')
  if (asked === 'xvfb')
    return xvfb === undefined
      ? { kind: 'fail', message: `ALTHAR_E2E_DISPLAY=xvfb, but Xvfb isn't installed. Install it (${XVFB_PACKAGES}).` }
      : { kind: 'xvfb', program: xvfb, asked: true }
  if (asked !== '') return { kind: 'fail', message: `ALTHAR_E2E_DISPLAY is inherit, xvfb or headless, not ${env.ALTHAR_E2E_DISPLAY}.` }
  return xvfb === undefined ? { kind: 'headless' } : { kind: 'xvfb', program: xvfb, asked: false }
}

/**
 * What Playwright and the app run with on a virtual display: none of the person's displays, only the one chosen, and not
 * their session bus either, over which a tray icon would reach their panel and a notification their desktop whatever the
 * display (e2e.ts gives the run a private bus where dbus-run-session is installed).
 */
export const displayEnv = (
  display: Display,
  env: Env,
  x?: { readonly display: string; readonly authority: string },
): Record<string, string | undefined> => {
  if (display.kind !== 'xvfb' && display.kind !== 'headless') return { ...env }
  const {
    DISPLAY: _display,
    WAYLAND_DISPLAY: _wayland,
    XAUTHORITY: _auth,
    XDG_SESSION_TYPE: _session,
    ALTHAR_E2E_OZONE: _ozone,
    ...rest
  } = env
  const own = { ...rest, DBUS_SESSION_BUS_ADDRESS: 'disabled:' }
  return display.kind === 'xvfb'
    ? { ...own, DISPLAY: x?.display, XAUTHORITY: x?.authority, XDG_SESSION_TYPE: 'x11' }
    : { ...own, ALTHAR_E2E_OZONE: 'headless' }
}

/**
 * The run's own session bus (dbus-run-session --config-file): a bare one, as CI's, that starts none of the desktop's
 * services when the app asks for them (its portals, its wallet, its file system), which on the person's computer would
 * otherwise each start on the run's bus, for nothing.
 */
export const BUS_CONFIG = `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`

/** An Xauthority file of one MIT-MAGIC-COOKIE-1 entry for any host, on `number` (any display where empty). */
export const authorityFile = (cookie: Buffer, number = ''): Buffer => {
  const short = (value: number) => {
    const bytes = Buffer.alloc(2)
    bytes.writeUInt16BE(value)
    return bytes
  }
  const field = (bytes: Buffer) => Buffer.concat([short(bytes.length), bytes])
  const FAMILY_WILD = 0xffff
  return Buffer.concat([
    short(FAMILY_WILD),
    field(Buffer.alloc(0)),
    field(Buffer.from(number)),
    field(Buffer.from('MIT-MAGIC-COOKIE-1')),
    field(cookie),
  ])
}

export interface Xvfb {
  readonly server: ChildProcess
  /** The Xauthority file only this run's clients have, as xvfb-run makes: the server takes no one without its cookie. */
  readonly authority: string
  /** The display, once the server has picked it (`:N`); rejects where it exits first, or doesn't say within the wait. */
  readonly ready: Promise<string>
  /** Stops the server, starting or started, and takes its cookie away. */
  readonly stop: () => void
}

/** Starts Xvfb on a free display, which it picks and names on a pipe of its own (-displayfd), with a cookie of this run's. */
export const startXvfb = (program: string, wait = 10_000): Xvfb => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-xvfb-'))
  const authority = join(folder, 'Xauthority')
  const cookie = randomBytes(16)
  writeFileSync(authority, authorityFile(cookie), { mode: 0o600 })
  const server = spawn(program, ['-displayfd', '3', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp', '-auth', authority], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  })
  const stop = () => {
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM')
    rmSync(folder, { recursive: true, force: true })
  }
  const ready = new Promise<string>((resolve, reject) => {
    let said = ''
    let errors = ''
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
      // Now on its number, as xvfb-run writes it; the same cookie, so the server, rereading it as it resets, takes it too.
      writeFileSync(authority, authorityFile(cookie, number), { mode: 0o600 })
      resolve(`:${number}`)
    })
  })
  return { server, authority, ready, stop }
}
