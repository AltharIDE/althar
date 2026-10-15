import { afterEach, describe, expect, it, vi } from 'vitest'

/* The keys and the words for this computer, read once from the system the window runs on. */

const on = async (platform?: string) => {
  vi.resetModules()
  if (platform !== undefined) vi.stubGlobal('window', { althar: { platform } })
  return { keys: await import('../src/foundations/keys'), device: await import('../src/foundations/device') }
}

afterEach(() => vi.unstubAllGlobals())

describe('keys', () => {
  it('are a Mac’s glyphs on a Mac, and where nothing says otherwise', async () => {
    for (const platform of ['darwin', undefined]) {
      const { keys } = await on(platform)
      expect(keys.modKey('N')).toBe('⌘N')
      expect(keys.modKey(keys.keys.enter)).toBe('⌘↵')
      expect(keys.modKey(keys.keys.return)).toBe('⌘⏎')
      expect(keys.chord(keys.keys.mod, keys.keys.shift, '5')).toBe('⌘⇧5')
      expect(keys.chord(keys.keys.alt, 'Z')).toBe('⌥Z')
      expect(keys.primaryDown({ metaKey: true, ctrlKey: false })).toBe(true)
      expect(keys.primaryDown({ metaKey: false, ctrlKey: true })).toBe(false)
    }
  })

  it('are Ctrl, Alt and Shift joined with a plus on Linux and Windows, and Ctrl is the primary modifier', async () => {
    for (const platform of ['linux', 'win32']) {
      const { keys } = await on(platform)
      expect(keys.modKey('N')).toBe('Ctrl+N')
      expect(keys.modKey(keys.keys.enter)).toBe('Ctrl+Enter')
      expect(keys.modKey(keys.keys.return)).toBe('Ctrl+Enter')
      expect(keys.chord(keys.keys.mod, keys.keys.shift, '5')).toBe('Ctrl+Shift+5')
      expect(keys.chord(keys.keys.alt, 'Z')).toBe('Alt+Z')
      expect(keys.primaryDown({ metaKey: false, ctrlKey: true })).toBe(true)
      expect(keys.primaryDown({ metaKey: true, ctrlKey: false })).toBe(false)
    }
  })
})

describe('this computer', () => {
  it('is named by the system the window runs on', async () => {
    expect((await on('linux')).device.device.this).toBe('this computer')
    expect((await on('win32')).device.device.this).toBe('this PC')
    expect((await on('darwin')).device.device.this).toBe('this Mac')
  })
})
