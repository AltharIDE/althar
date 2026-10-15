import { describe, expect, it, vi } from 'vitest'

import {
  keyringIsSafe,
  keyringUnavailable,
  passwordStore,
  portalKeyUnavailable,
  portalSealUnavailable,
  PORTAL_FEATURE,
  sealWithPortal,
  sealsWithPortal,
  withPortalFeature,
  type SafeStorageLike,
} from '../src/main/keyring'

const storage = (overrides: Partial<SafeStorageLike> = {}): SafeStorageLike => ({
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value) => Buffer.from(`v10${value}`)),
  decryptString: vi.fn((sealed) => sealed.toString().slice(3)),
  encryptStringAsync: vi.fn(async (value) => Buffer.from(`v12${value}`)),
  decryptStringAsync: vi.fn(async (sealed) => ({ result: sealed.toString().slice(3), shouldReEncrypt: false })),
  ...overrides,
})

const encoded = (tag: string, value = 'ciphertext') => Buffer.from(`${tag}${value}`).toString('base64')

describe('sealing secrets by keyring', () => {
  it('takes a real keyring on Linux, and nothing else', () => {
    expect(keyringIsSafe('linux', 'gnome_libsecret')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet5')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet6')).toBe(true)
    expect(keyringIsSafe('linux', 'basic_text')).toBe(false)
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
    // Every Flatpak desktop, including KDE, uses the same portal-first path.
    expect(passwordStore([], 'KDE', true, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore([], 'GNOME', true, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore([], 'Hyprland', true, 'linux')).toBe('gnome-libsecret')
    expect(passwordStore([], undefined, false, 'darwin')).toBeNull()
    expect(passwordStore([], 'Hyprland', false, 'win32')).toBeNull()
  })
})

describe('the Secret portal and session fallback', () => {
  it('prefers the app-specific portal on every Linux Flatpak desktop', () => {
    expect(sealsWithPortal(true, 'linux')).toBe(true)
    expect(sealsWithPortal(false, 'linux')).toBe(false)
    expect(sealsWithPortal(true, 'darwin')).toBe(false)
  })

  it('turns the portal key on for sealing while preserving features the person passed', () => {
    expect(withPortalFeature('')).toBe(PORTAL_FEATURE)
    expect(withPortalFeature('WaylandWindowDecorations')).toBe(`WaylandWindowDecorations,${PORTAL_FEATURE}`)
    expect(withPortalFeature(`${PORTAL_FEATURE},Other`)).toBe(`${PORTAL_FEATURE},Other`)
  })

  it('seals with and opens the app-specific portal format', async () => {
    const sealStore = storage()
    const sealed = await sealWithPortal(true, 'credential', sealStore, 'linux')
    expect('value' in sealed && Buffer.from(sealed.value, 'base64').subarray(0, 3).toString()).toBe('v12')
    expect(vi.mocked(sealStore.encryptStringAsync)).toHaveBeenCalledWith('credential')
    expect(vi.mocked(sealStore.encryptString)).not.toHaveBeenCalled()

    const openStore = storage()
    const opened = await sealWithPortal(false, encoded('v12', 'credential'), openStore, 'linux')
    expect(opened).toEqual({ value: 'credential' })
    expect(vi.mocked(openStore.decryptStringAsync)).toHaveBeenCalledWith(Buffer.from('v12credential'))
    expect(vi.mocked(openStore.decryptString)).not.toHaveBeenCalled()
  })

  it('retries async decryption when Electron reports that its key was rotated', async () => {
    const decryptStringAsync = vi
      .fn()
      .mockResolvedValueOnce({ result: 'old-key-read', shouldReEncrypt: true })
      .mockResolvedValueOnce({ result: 'credential', shouldReEncrypt: false })
    const store = storage({ decryptStringAsync })
    expect(await sealWithPortal(false, encoded('v12'), store, 'linux')).toEqual({ value: 'credential' })
    expect(decryptStringAsync).toHaveBeenCalledTimes(2)
  })

  it('falls back to safe sync safeStorage for the current session when the portal is absent or returns a shared format', async () => {
    const absent = storage({ encryptStringAsync: vi.fn(async () => Buffer.from('v10fixed-fallback')) })
    const sealed = await sealWithPortal(true, 'credential', absent, 'linux')
    expect(sealed).toEqual({ value: encoded('v10', 'credential') })
    expect(vi.mocked(absent.encryptString)).toHaveBeenCalledWith('credential')

    const openStore = storage()
    const opened = await sealWithPortal(false, encoded('v10', 'credential'), openStore, 'linux')
    expect(opened).toEqual({ value: 'credential' })
    expect(vi.mocked(openStore.decryptString)).toHaveBeenCalled()
  })

  it('falls back to a safe sync keyring when the portal errors, but never uses basic_text', async () => {
    const erroring = storage({ encryptStringAsync: vi.fn(async () => Promise.reject(new Error('portal unavailable'))) })
    expect(await sealWithPortal(true, 'credential', erroring, 'linux')).toEqual({ value: encoded('v10', 'credential') })

    const noKeyring = storage({
      getSelectedStorageBackend: vi.fn(() => 'basic_text'),
      encryptStringAsync: vi.fn(async () => Buffer.from('v10fixed-fallback')),
    })
    expect(await sealWithPortal(true, 'credential', noKeyring, 'linux')).toEqual({ error: portalKeyUnavailable, keyring: true })
    expect(vi.mocked(noKeyring.encryptString)).not.toHaveBeenCalled()

    const sharedKeyring = storage({
      getSelectedStorageBackend: vi.fn(() => 'kwallet6'),
      encryptStringAsync: vi.fn(async () => Buffer.from('v11shared-service')),
    })
    expect(await sealWithPortal(true, 'credential', sharedKeyring, 'linux')).toEqual({ error: portalKeyUnavailable, keyring: true })
    expect(vi.mocked(sharedKeyring.encryptString)).not.toHaveBeenCalled()
  })

  it('does not open shared-service or fixed-key async seals, or fall back from a failed portal seal', async () => {
    const shared = storage()
    expect(await sealWithPortal(false, encoded('v11'), shared, 'linux')).toEqual({ error: portalSealUnavailable, keyring: true })
    expect(vi.mocked(shared.decryptString)).not.toHaveBeenCalled()

    const failedPortal = storage({ decryptStringAsync: vi.fn(async () => Promise.reject(new Error('portal unavailable'))) })
    expect(await sealWithPortal(false, encoded('v12'), failedPortal, 'linux')).toEqual({ error: portalSealUnavailable, keyring: true })
    expect(vi.mocked(failedPortal.decryptString)).not.toHaveBeenCalled()
  })
})
