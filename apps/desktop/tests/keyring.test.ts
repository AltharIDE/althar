import { describe, expect, it } from 'vitest'

import { keyringIsSafe, keyringUnavailable, passwordStore } from '../src/main/keyring'

describe('sealing secrets by keyring', () => {
  it('takes a real keyring on Linux, and nothing else', () => {
    expect(keyringIsSafe('linux', 'gnome_libsecret')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet5')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet6')).toBe(true)
    expect(keyringIsSafe('linux', 'basic_text')).toBe(false)
    // An allow-list, so anything it doesn't know — Electron's own `unknown` before it is ready, or a backend a later Electron adds — fails closed.
    expect(keyringIsSafe('linux', 'unknown')).toBe(false)
    expect(keyringIsSafe('linux', 'a_backend_from_the_future')).toBe(false)
  })

  it('leaves the platforms with a keychain of their own to Electron', () => {
    expect(keyringIsSafe('darwin', 'basic_text')).toBe(true)
    expect(keyringIsSafe('win32', 'basic_text')).toBe(true)
  })

  it('says what to do about it, by platform', () => {
    expect(keyringUnavailable('linux')).toContain('gnome-keyring')
    expect(keyringUnavailable('linux')).toContain('KWallet')
    expect(keyringUnavailable('darwin')).toBe('The keychain Althar seals sign-ins with isn’t available.')
  })
})

describe('the password store Electron is asked for', () => {
  it('asks for libsecret where Electron would pick plain text, and leaves a choice of the person’s alone', () => {
    expect(passwordStore([], undefined, false)).toBe('gnome-libsecret')
    expect(passwordStore([], 'Hyprland', false)).toBe('gnome-libsecret')
    expect(passwordStore([], 'sway', false)).toBe('gnome-libsecret')
    expect(passwordStore([], 'GNOME', false)).toBeNull()
    expect(passwordStore([], 'KDE', false)).toBeNull()
    expect(passwordStore(['--password-store=basic'], undefined, false)).toBeNull()
    // In a Flatpak the host's secret service is what is reachable; KWallet's own socket is not, so KDE needs it there too.
    expect(passwordStore([], 'KDE', true)).toBe('gnome-libsecret')
    // A Linux switch: macOS and Windows keep their own keychain.
    expect(passwordStore([], undefined, false, 'darwin')).toBeNull()
    expect(passwordStore([], 'Hyprland', false, 'win32')).toBeNull()
  })
})
