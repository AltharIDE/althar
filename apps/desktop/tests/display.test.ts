import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { chooseDisplay, displayEnv, startXvfb, XVFB_PACKAGES } from '../scripts/display'

const XVFB = '/usr/bin/Xvfb'
const installed = (command: string) => (command === 'Xvfb' ? XVFB : undefined)
const missing = () => undefined
/** A person's KDE Wayland session, with its Xwayland. */
const desktop = {
  WAYLAND_DISPLAY: 'wayland-0',
  DISPLAY: ':0',
  XAUTHORITY: '/run/user/1000/xauth',
  XDG_SESSION_TYPE: 'wayland',
  HOME: '/home/a',
}

describe("the end-to-end run's display", () => {
  it('starts Xvfb on Linux where it is installed, even on a desktop with a display of its own', () => {
    expect(chooseDisplay('linux', desktop, installed)).toEqual({ kind: 'xvfb', program: XVFB })
    expect(chooseDisplay('linux', {}, installed)).toEqual({ kind: 'xvfb', program: XVFB })
  })

  it("runs headless where Xvfb isn't installed, never on the person's display", () => {
    expect(chooseDisplay('linux', desktop, missing)).toEqual({ kind: 'headless' })
    expect(chooseDisplay('linux', {}, missing)).toEqual({ kind: 'headless' })
  })

  it('keeps the display the person asks for, to watch a run', () => {
    expect(chooseDisplay('linux', { ...desktop, ALTHAR_E2E_DISPLAY: 'inherit' }, installed)).toMatchObject({ kind: 'inherit' })
    expect(displayEnv({ kind: 'inherit', why: '' }, desktop)).toEqual(desktop)
  })

  it("keeps CI's own xvfb-run display, and makes one where CI has none", () => {
    expect(chooseDisplay('linux', { CI: 'true', DISPLAY: ':99' }, installed)).toMatchObject({ kind: 'inherit' })
    expect(chooseDisplay('linux', { CI: 'true' }, installed)).toEqual({ kind: 'xvfb', program: XVFB })
    expect(chooseDisplay('linux', { CI: 'true' }, missing)).toEqual({ kind: 'headless' })
  })

  it('takes Xvfb or headless when asked, and names the package where Xvfb is asked for and missing', () => {
    expect(chooseDisplay('linux', { ALTHAR_E2E_DISPLAY: 'headless' }, installed)).toEqual({ kind: 'headless' })
    expect(chooseDisplay('linux', { ALTHAR_E2E_DISPLAY: 'xvfb' }, installed)).toEqual({ kind: 'xvfb', program: XVFB })
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

  it("gives Playwright the run's own display and none of the person's", () => {
    expect(displayEnv({ kind: 'xvfb', program: XVFB }, desktop, ':7')).toEqual({ HOME: '/home/a', DISPLAY: ':7', XDG_SESSION_TYPE: 'x11' })
    expect(displayEnv({ kind: 'headless' }, desktop)).toEqual({ HOME: '/home/a', ALTHAR_E2E_OZONE: 'headless' })
  })
})

describe.skipIf(process.platform === 'win32')('Xvfb, started for a run', () => {
  /** A stand-in for Xvfb: says `said` on the display pipe, as -displayfd asks, then runs until stopped. */
  const standIn = (said: string) => {
    const program = join(mkdtempSync(join(tmpdir(), 'althar-xvfb-')), 'Xvfb')
    writeFileSync(program, `#!/bin/sh\n${said === '' ? 'exit 1' : `printf '${said}' >&3\nexec sleep 30`}\n`)
    chmodSync(program, 0o755)
    return program
  }

  it('takes the display it picked, and is gone once stopped', async () => {
    const running = await startXvfb(standIn('42\\n'))
    expect(running.display).toBe(':42')
    const stopped = new Promise((resolve) => running.server.once('exit', resolve))
    running.stop()
    await expect(stopped).resolves.toBeDefined()
  })

  it('fails where it exits before naming a display', async () => {
    await expect(startXvfb(standIn(''))).rejects.toThrow(/Xvfb didn't start/)
  })
})
