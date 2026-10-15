import { describe, expect, it } from 'vitest'

import {
  keyringIsSafe,
  keyringUnavailable,
  passwordStore,
  portalKeyUnavailable,
  portalSealUnavailable,
  PORTAL_FEATURE,
  sealedByPortal,
  sealsWithPortal,
  withPortalFeature,
} from '../src/main/keyring'

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

  it('gives a specific failure when the app-specific Secret portal key is missing', () => {
    expect(portalKeyUnavailable).toContain('desktop Secret portal')
    expect(portalSealUnavailable).toContain('Sign in again')
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
    // In a Flatpak the host's secret service is what is reachable; KWallet's own socket is not, so KDE needs it there too.
    expect(passwordStore([], 'KDE', true, 'linux')).toBe('gnome-libsecret')
    // A Linux switch: macOS and Windows keep their own keychain.
    expect(passwordStore([], undefined, false, 'darwin')).toBeNull()
    expect(passwordStore([], 'Hyprland', false, 'win32')).toBeNull()
  })
})

describe('sealing with the Secret portal’s key', () => {
  it('is for a Flatpak off KDE, where libsecret’s key would be new at every start', () => {
    expect(sealsWithPortal('GNOME', true, 'linux')).toBe(true)
    expect(sealsWithPortal('ubuntu:GNOME', true, 'linux')).toBe(true)
    expect(sealsWithPortal('Hyprland', true, 'linux')).toBe(true)
    expect(sealsWithPortal(undefined, true, 'linux')).toBe(true)
    // KDE keeps KWallet itself, as it was.
    expect(sealsWithPortal('KDE', true, 'linux')).toBe(false)
    expect(sealsWithPortal('X-Generic:KDE', true, 'linux')).toBe(false)
    // Outside a Flatpak libsecret looks up where it stores; macOS and Windows keep their keychain.
    expect(sealsWithPortal('GNOME', false, 'linux')).toBe(false)
    expect(sealsWithPortal(undefined, true, 'darwin')).toBe(false)
  })

  it('turns the portal’s key on for sealing, keeping the features the person passed', () => {
    expect(withPortalFeature('')).toBe(PORTAL_FEATURE)
    expect(withPortalFeature('WaylandWindowDecorations')).toBe(`WaylandWindowDecorations,${PORTAL_FEATURE}`)
    expect(withPortalFeature(`${PORTAL_FEATURE},Other`)).toBe(`${PORTAL_FEATURE},Other`)
  })

  it('keeps and opens only seals from the app-specific Secret portal key', () => {
    const sealed = (tag: string) => new TextEncoder().encode(`${tag}\u0001\u0002ciphertext`)
    expect(sealedByPortal(sealed('v12'))).toBe(true)
    // v11 is the shared Secret Service key; v10 is Chromium's fixed key.
    expect(sealedByPortal(sealed('v11'))).toBe(false)
    expect(sealedByPortal(sealed('v10'))).toBe(false)
    // An allow-list: nothing, plain text, or a tag a later Chromium adds fails closed.
    expect(sealedByPortal(new Uint8Array())).toBe(false)
    expect(sealedByPortal(new TextEncoder().encode('ghp_plain'))).toBe(false)
    expect(sealedByPortal(sealed('v13'))).toBe(false)
  })
})
