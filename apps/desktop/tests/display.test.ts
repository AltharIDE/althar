import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { authorityFile, chooseDisplay, displayEnv, startXvfb, XVFB_PACKAGES } from '../scripts/display'

const XVFB = '/usr/bin/Xvfb'
const installed = (command: string) => (command === 'Xvfb' ? XVFB : undefined)
const missing = () => undefined
/** A person's KDE Wayland session, with its Xwayland. */
const desktop = {
  WAYLAND_DISPLAY: 'wayland-0',
  DISPLAY: ':0',
  XAUTHORITY: '/run/user/1000/xauth',
  XDG_SESSION_TYPE: 'wayland',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  HOME: '/home/a',
}

describe("the end-to-end run's display", () => {
  it('starts Xvfb on Linux where it is installed, even on a desktop with a display of its own', () => {
    expect(chooseDisplay('linux', desktop, installed)).toEqual({ kind: 'xvfb', program: XVFB, asked: false })
    expect(chooseDisplay('linux', {}, installed)).toEqual({ kind: 'xvfb', program: XVFB, asked: false })
  })

  it("runs headless where Xvfb isn't installed, never on the person's display", () => {
    expect(chooseDisplay('linux', desktop, missing)).toEqual({ kind: 'headless' })
    expect(chooseDisplay('linux', {}, missing)).toEqual({ kind: 'headless' })
  })

  it('keeps the display the person asks for, to watch a run', () => {
    expect(chooseDisplay('linux', { ...desktop, ALTHAR_E2E_DISPLAY: 'inherit' }, installed)).toMatchObject({ kind: 'inherit' })
    expect(displayEnv({ kind: 'inherit' }, desktop)).toEqual(desktop)
  })

  it("keeps CI's xvfb-run display only where the workflow says so, never for CI alone", () => {
    expect(chooseDisplay('linux', { CI: 'true', DISPLAY: ':99', ALTHAR_E2E_DISPLAY: 'inherit' }, installed)).toEqual({ kind: 'inherit' })
    for (const CI of ['true', 'false', '1'])
      expect(chooseDisplay('linux', { ...desktop, CI }, installed)).toEqual({ kind: 'xvfb', program: XVFB, asked: false })
    expect(chooseDisplay('linux', { ...desktop, CI: 'true' }, missing)).toEqual({ kind: 'headless' })
  })

  it('takes Xvfb or headless when asked, and names the package where Xvfb is asked for and missing', () => {
    expect(chooseDisplay('linux', { ALTHAR_E2E_DISPLAY: 'headless' }, installed)).toEqual({ kind: 'headless' })
    expect(chooseDisplay('linux', { ALTHAR_E2E_DISPLAY: 'xvfb' }, installed)).toEqual({ kind: 'xvfb', program: XVFB, asked: true })
    const failed = chooseDisplay('linux', { ALTHAR_E2E_DISPLAY: 'xvfb' }, missing)
    expect(failed).toEqual({ kind: 'fail', message: expect.stringContaining(XVFB_PACKAGES) })
    expect(XVFB_PACKAGES).toMatch(/xorg-x11-server-Xvfb.*xvfb.*xorg-server-xvfb/)
    expect(chooseDisplay('linux', { ALTHAR_E2E_DISPLAY: 'wayland' }, installed)).toMatchObject({ kind: 'fail' })
  })

  it('leaves macOS and Windows as they are', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(chooseDisplay(platform, desktop, installed)).toEqual({ kind: 'untouched' })
      expect(chooseDisplay(platform, { ALTHAR_E2E_DISPLAY: 'xvfb' }, missing)).toEqual({ kind: 'untouched' })
    }
    expect(displayEnv({ kind: 'untouched' }, desktop)).toEqual(desktop)
  })

  it("gives Playwright the run's own display and cookie, and none of the person's displays or session bus", () => {
    expect(displayEnv({ kind: 'xvfb', program: XVFB, asked: false }, desktop, { display: ':7', authority: '/tmp/x/Xauthority' })).toEqual({
      HOME: '/home/a',
      DBUS_SESSION_BUS_ADDRESS: 'disabled:',
      DISPLAY: ':7',
      XAUTHORITY: '/tmp/x/Xauthority',
      XDG_SESSION_TYPE: 'x11',
    })
    expect(displayEnv({ kind: 'headless' }, desktop)).toEqual({
      HOME: '/home/a',
      DBUS_SESSION_BUS_ADDRESS: 'disabled:',
      ALTHAR_E2E_OZONE: 'headless',
    })
  })

  it('writes an Xauthority entry as xauth does: any host, the display number, and the cookie', () => {
    const cookie = Buffer.alloc(16, 0xab)
    const entry = authorityFile(cookie, '7')
    expect(entry.readUInt16BE(0)).toBe(0xffff)
    expect(entry.subarray(2).toString('hex')).toBe(
      [
        '0000',
        '0001',
        Buffer.from('7').toString('hex'),
        '0012',
        Buffer.from('MIT-MAGIC-COOKIE-1').toString('hex'),
        '0010',
        cookie.toString('hex'),
      ].join(''),
    )
  })
})

describe.skipIf(process.platform === 'win32')('Xvfb, started for a run', () => {
  /** A stand-in for Xvfb: keeps its arguments, says `said` on the display pipe, as -displayfd asks, then runs until stopped. */
  const standIn = (said: string) => {
    const program = join(mkdtempSync(join(tmpdir(), 'althar-xvfb-')), 'Xvfb')
    const speak = said === '' ? 'exit 1' : said === 'never' ? 'exec sleep 30' : `printf '${said}' >&3\nexec sleep 30`
    writeFileSync(program, `#!/bin/sh\necho "$@" > "${program}.args"\n${speak}\n`)
    chmodSync(program, 0o755)
    return program
  }
  const exited = (xvfb: ReturnType<typeof startXvfb>) =>
    xvfb.server.exitCode !== null || xvfb.server.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => xvfb.server.once('exit', resolve))

  it('takes the display it picked, with a cookie only the run has, and both are gone once stopped', async () => {
    const program = standIn('42\\n')
    const xvfb = startXvfb(program)
    expect(await xvfb.ready).toBe(':42')
    expect(readFileSync(`${program}.args`, 'utf8')).toContain(`-nolisten tcp -auth ${xvfb.authority}`)
    expect(statSync(xvfb.authority).mode & 0o777).toBe(0o600)
    expect(readFileSync(xvfb.authority).toString('latin1')).toContain('MIT-MAGIC-COOKIE-1')
    xvfb.stop()
    await exited(xvfb)
    expect(existsSync(dirname(xvfb.authority))).toBe(false)
  })

  it('stops a server still starting, as a signal to the run does', async () => {
    const xvfb = startXvfb(standIn('never'))
    const ready = xvfb.ready.catch((error: Error) => error)
    xvfb.stop()
    await exited(xvfb)
    expect(xvfb.server.signalCode ?? xvfb.server.exitCode).not.toBeNull()
    expect(await ready).toBeInstanceOf(Error)
    expect(existsSync(dirname(xvfb.authority))).toBe(false)
  })

  it('fails where it exits before naming a display', async () => {
    await expect(startXvfb(standIn('')).ready).rejects.toThrow(/Xvfb didn't start/)
  })
})
