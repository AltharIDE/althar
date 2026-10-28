import { describe, expect, it } from 'vitest'

import { HIDDEN, loginItemOf, openedAtLogin, opensAtLogin } from '../src/main/loginItem'

describe('opening Althar at login, in the background', () => {
  it('is offered on a Mac and on Windows, not on Linux', () => {
    expect(opensAtLogin('darwin')).toBe(true)
    expect(opensAtLogin('win32')).toBe(true)
    expect(opensAtLogin('linux')).toBe(false)
  })

  it('tells the system the switch, and on Windows the argument that says the launch was at login', () => {
    expect(loginItemOf(true, 'darwin')).toEqual({ openAtLogin: true })
    expect(loginItemOf(false, 'darwin')).toEqual({ openAtLogin: false })
    expect(loginItemOf(true, 'win32')).toEqual({ openAtLogin: true, args: [HIDDEN] })
  })

  it('knows a launch at login as a Mac says it, or by the argument on Windows, and never on Linux', () => {
    expect(openedAtLogin('darwin', [], true)).toBe(true)
    expect(openedAtLogin('darwin', [HIDDEN], false)).toBe(false)
    expect(openedAtLogin('win32', ['Althar.exe', HIDDEN], false)).toBe(true)
    expect(openedAtLogin('win32', ['Althar.exe'], true)).toBe(false)
    expect(openedAtLogin('linux', [HIDDEN], true)).toBe(false)
  })
})
