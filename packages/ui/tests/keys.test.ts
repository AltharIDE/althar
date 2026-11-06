import { afterEach, describe, expect, it, vi } from 'vitest'

/* The keys and the words for this computer, read once from the system the window runs on. */

const on = async (platform?: string) => {
  vi.unstubAllGlobals()
  vi.resetModules()
  if (platform !== undefined) vi.stubGlobal('window', { althar: { platform } })
  return { keys: await import('../src/foundations/keys'), device: await import('../src/foundations/device') }
}

afterEach(() => vi.unstubAllGlobals())

describe('keys', () => {
  it('are a Mac’s glyphs on macOS', async () => {
    const { keys } = await on('darwin')
    expect(keys.modKey('N')).toBe('⌘N')
    expect(keys.modKey(keys.keys.enter)).toBe('⌘↵')
    expect(keys.modKey(keys.keys.return)).toBe('⌘⏎')
    expect(keys.chord(keys.keys.mod, keys.keys.shift, '5')).toBe('⌘⇧5')
    expect(keys.chord(keys.keys.alt, 'Z')).toBe('⌥Z')
    expect(keys.primaryDown({ metaKey: true, ctrlKey: false })).toBe(true)
    expect(keys.primaryDown({ metaKey: false, ctrlKey: true })).toBe(false)
    expect(keys.commandDown({ metaKey: false, ctrlKey: true })).toBe(true)
    expect(keys.commandDown({ metaKey: true, ctrlKey: false })).toBe(true)
    expect(keys.commandDown({ metaKey: false, ctrlKey: false })).toBe(false)
  })

  it('falls back to Mac glyphs when the window does not name a platform', async () => {
    const { keys, device } = await on()
    expect(device.device.this).toBe('this Mac')
    expect(keys.modKey('N')).toBe('⌘N')
    expect(keys.modKey(keys.keys.enter)).toBe('⌘↵')
    expect(keys.modKey(keys.keys.return)).toBe('⌘⏎')
    expect(keys.chord(keys.keys.mod, keys.keys.shift, '5')).toBe('⌘⇧5')
    expect(keys.chord(keys.keys.alt, 'Z')).toBe('⌥Z')
    expect(keys.primaryDown({ metaKey: true, ctrlKey: false })).toBe(true)
    expect(keys.primaryDown({ metaKey: false, ctrlKey: true })).toBe(false)
    expect(keys.commandDown({ metaKey: false, ctrlKey: true })).toBe(true)
    expect(keys.commandDown({ metaKey: true, ctrlKey: false })).toBe(true)
    expect(keys.commandDown({ metaKey: false, ctrlKey: false })).toBe(false)
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

  it('count Ctrl alone as the command key on Linux and Windows, never Super or the Windows key', async () => {
    for (const platform of ['linux', 'win32']) {
      const { keys } = await on(platform)
      expect(keys.commandDown({ metaKey: false, ctrlKey: true })).toBe(true)
      expect(keys.commandDown({ metaKey: true, ctrlKey: false })).toBe(false)
      expect(keys.commandDown({ metaKey: false, ctrlKey: false })).toBe(false)
      expect(keys.primaryDown({ metaKey: true, ctrlKey: true })).toBe(false)
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
