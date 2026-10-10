import { describe, expect, it } from 'vitest'

import { keyringIsSafe, keyringUnavailable } from '../src/main/keyring'

describe('sealing secrets by keyring', () => {
  it('takes a real keyring on Linux', () => {
    expect(keyringIsSafe('linux', 'gnome_libsecret')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet5')).toBe(true)
    expect(keyringIsSafe('linux', 'kwallet6')).toBe(true)
  })

  it('refuses plain text on Linux, whatever else answers', () => {
    expect(keyringIsSafe('linux', 'basic_text')).toBe(false)
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
