import { describe, expect, it } from 'vitest'

import { keyringIsSafe, keyringUnavailable, passwordStore, sealFailure, walletOf } from '../src/main/keyring'

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

describe('what main answers when safeStorage throws', () => {
  it('says a sealed secret it cannot open is unreadable, which the runtime does not ask again, and a seal that fails is not', () => {
    const thrown = new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    expect(sealFailure('open', thrown)).toEqual({ error: thrown.message, unreadable: true })
    expect(sealFailure('seal', new Error('Encryption is not available.'))).toEqual({ error: 'Encryption is not available.' })
    expect(sealFailure('open', 'odd')).toEqual({ error: 'odd', unreadable: true })
  })
})

describe('which KWallet a Flatpak on KDE asks for', () => {
  // The sandbox's environment has XDG_CURRENT_DESKTOP=KDE and no KDE_SESSION_VERSION: the bus is what says.
  it('asks the session bus, since the sandbox is not told the Plasma version', () => {
    expect(walletOf((name) => name === 'org.kde.kwalletd6', undefined)).toBe('kwallet6')
    expect(walletOf((name) => name === 'org.kde.kwalletd5', undefined)).toBe('kwallet5')
    expect(walletOf((name) => name.startsWith('org.kde.kwalletd'), undefined)).toBe('kwallet6')
  })

  it('falls back to Plasma 6, unless the person said the session is 5', () => {
    expect(walletOf(() => false, undefined)).toBe('kwallet6')
    expect(walletOf(() => false, '6')).toBe('kwallet6')
    expect(walletOf(() => false, '5')).toBe('kwallet5')
  })
})

describe('the password store Electron is asked for', () => {
  it('asks for libsecret where Electron would pick plain text, and leaves a choice of the person’s alone', () => {
    expect(passwordStore([], undefined, false, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore([], 'Hyprland', false, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore([], 'sway', false, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore([], 'GNOME', false, 'linux')).toBeNull()
    expect(passwordStore([], 'KDE', false, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore(['--password-store=basic'], undefined, false, 'linux')).toBeNull()
    expect(passwordStore(['--password-store', 'basic'], undefined, false, 'linux')).toBeNull()
    // In a Flatpak libsecret keeps its own file keyring, whose key Chromium doesn't find again: KDE asks for KWallet itself, and everywhere else libsecret.
    expect(passwordStore([], 'KDE', true, 'linux')).toBe('kwallet6')
    expect(passwordStore([], 'KDE', true, 'linux', 'kwallet5')).toBe('kwallet5')
    expect(passwordStore([], 'ubuntu:GNOME', true, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore([], 'sway', true, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore(['--password-store=gnome-libsecret'], 'KDE', true, 'linux')).toBeNull()
    // A Linux switch: macOS and Windows keep their own keychain.
    expect(passwordStore([], undefined, false, 'darwin')).toBeNull()
    expect(passwordStore([], 'Hyprland', false, 'win32')).toBeNull()
  })
})
