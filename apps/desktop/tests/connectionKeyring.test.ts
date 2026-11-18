import { describe, expect, it, vi } from 'vitest'

import { protectConnectionCredential, type SafeStorageLike } from '../src/main/keyring'

const storage = () =>
  ({
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(() => Buffer.from('v11encrypted')),
    decryptString: vi.fn(() => 'private-key'),
    encryptStringAsync: vi.fn(async () => Buffer.from('v12portal')),
    decryptStringAsync: vi.fn(async () => ({ result: 'private-key', shouldReEncrypt: false })),
  }) satisfies SafeStorageLike

describe('connection key sealing', () => {
  it('refuses missing, unknown and plaintext Linux backends before asking them to encrypt', async () => {
    for (const backend of ['basic_text', 'unknown']) {
      const safe = storage()
      safe.getSelectedStorageBackend.mockReturnValue(backend)
      await expect(protectConnectionCredential(true, 'private-key', safe, 'linux')).rejects.toThrow('keyring')
      expect(safe.encryptString).not.toHaveBeenCalled()
    }
    const absent = storage()
    absent.isEncryptionAvailable.mockReturnValue(false)
    await expect(protectConnectionCredential(true, 'private-key', absent, 'win32')).rejects.toThrow('keyring')
  })

  it('round-trips the safe OS port and rejects a Linux fixed-key envelope even if the backend reports a keyring', async () => {
    const safe = storage()
    const encrypted = await protectConnectionCredential(true, 'private-key', safe, 'linux')
    expect(await protectConnectionCredential(false, encrypted, safe, 'linux')).toBe('private-key')
    safe.encryptString.mockReturnValue(Buffer.from('v10fixed'))
    await expect(protectConnectionCredential(true, 'private-key', safe, 'linux')).rejects.toThrow('keyring')
    await expect(protectConnectionCredential(false, Buffer.from('v10fixed').toString('base64'), safe, 'linux')).rejects.toThrow('keyring')
  })

  it('uses the app-specific Secret portal port when configured and keeps failures recoverable', async () => {
    const safe = storage()
    const encrypted = await protectConnectionCredential(true, 'private-key', safe, 'linux', true)
    expect(await protectConnectionCredential(false, encrypted, safe, 'linux', true)).toBe('private-key')
    expect(safe.encryptString).not.toHaveBeenCalled()
    safe.decryptStringAsync.mockRejectedValue(new Error('Locked'))
    await expect(protectConnectionCredential(false, encrypted, safe, 'linux', true)).rejects.toThrow()
  })
})
