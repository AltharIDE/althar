import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { desktopScheme, type Scheme, themeSourceFor } from '../src/main/colorScheme'
import { PAGE, RAISED, windowOptions } from '../src/main/windowOptions'
import { followScheme } from '../src/renderer/shared/scheme'

/*
 * Light or dark: the window follows its scheme (which the main process sets
 * from Settings › Appearance through nativeTheme), and the paper under it is
 * the page's own colour in that scheme, so nothing of the other shows first.
 */

/** A media query whose answer the test turns. */
const scheme = (dark: boolean) => {
  const listeners = new Set<() => void>()
  const media = {
    matches: dark,
    addEventListener: vi.fn((_: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_: string, listener: () => void) => listeners.delete(listener)),
  }
  const turn = (to: boolean) => {
    media.matches = to
    for (const listener of listeners) listener()
  }
  return { media: media as unknown as MediaQueryList, turn, listeners }
}

describe('the window’s scheme', () => {
  it('takes it at once, follows it as it turns, and stops when told', () => {
    const root = document.createElement('html')
    const { media, turn, listeners } = scheme(true)
    const stop = followScheme(root, media)
    expect(root.dataset.theme).toBe('dark')
    turn(false)
    expect(root.dataset.theme).toBe('light')
    turn(true)
    expect(root.dataset.theme).toBe('dark')
    stop()
    expect(listeners.size).toBe(0)
    turn(false)
    expect(root.dataset.theme).toBe('dark')
  })

  it('reads the window’s own scheme where it is given nothing', () => {
    const matchMedia = vi.fn(() => scheme(false).media)
    vi.stubGlobal('matchMedia', matchMedia)
    try {
      followScheme()()
      expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
      expect(document.documentElement.dataset.theme).toBe('light')
    } finally {
      vi.unstubAllGlobals()
      delete document.documentElement.dataset.theme
    }
  })
})

/** A token's value in the kit's light or dark set, as written. */
const token = (file: 'tokens.css' | 'dark.css', name: string) => {
  const css = readFileSync(join(import.meta.dirname, '../../../packages/ui/src/styles', file), 'utf8')
  const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1]
  if (value === undefined) throw new Error(`No ${name} in ${file}`)
  return value
}

describe('the paper under the window', () => {
  it('is the page’s colour in each scheme, and a sheet’s the raised one, as the kit has them', () => {
    expect(PAGE).toEqual({ light: token('tokens.css', '--n-2'), dark: token('dark.css', '--n-2') })
    expect(RAISED).toEqual({ light: token('tokens.css', '--n-1'), dark: token('dark.css', '--n-1') })
  })

  it('is dark under a window opened in the dark scheme', () => {
    const icon = {} as Parameters<typeof windowOptions>[1]
    expect(windowOptions('darwin', icon, true).backgroundColor).toBe(PAGE.dark)
    expect(windowOptions('win32', icon).backgroundColor).toBe(PAGE.light)
  })
})

describe('what Electron is told to follow, by system', () => {
  it('is light or dark as chosen, on every system', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(themeSourceFor('light', platform, 1)).toBe('light')
      expect(themeSourceFor('dark', platform, 2)).toBe('dark')
    }
  })

  it('is the system’s own on a Mac and on Windows, which nativeTheme follows by itself', () => {
    expect(themeSourceFor('system', 'darwin', undefined)).toBe('system')
    expect(themeSourceFor('system', 'win32', 1)).toBe('system')
  })

  it('is the Linux desktop’s, from its Settings portal, where Electron has no word of it', () => {
    expect(themeSourceFor('system', 'linux', 1)).toBe('dark')
    expect(themeSourceFor('system', 'linux', 2)).toBe('light')
    // no preference, or no portal: Chromium's own guess
    expect(themeSourceFor('system', 'linux', 0)).toBe('system')
    expect(themeSourceFor('system', 'linux', undefined)).toBe('system')
  })
})

describe('the Linux desktop’s scheme, watched once', () => {
  it('starts one watch for all who follow it, tells a late one at once, and stops with the last', () => {
    let tell: (scheme: Scheme | undefined) => void = () => {}
    const stop = vi.fn()
    const watch = vi.fn((changed: (scheme: Scheme | undefined) => void) => {
      tell = changed
      return stop
    })
    const follow = desktopScheme(watch)
    const windows = vi.fn()
    const tray = vi.fn()
    const leaveWindows = follow(windows)
    tell(1)
    const leaveTray = follow(tray)
    expect(watch).toHaveBeenCalledOnce()
    expect(windows).toHaveBeenLastCalledWith(1)
    expect(tray).toHaveBeenLastCalledWith(1)
    tell(2)
    expect(windows).toHaveBeenLastCalledWith(2)
    expect(tray).toHaveBeenLastCalledWith(2)
    leaveWindows()
    expect(stop).not.toHaveBeenCalled()
    leaveTray()
    expect(stop).toHaveBeenCalledOnce()
    // asked again, it watches afresh, and tells nothing it heard before
    const again = vi.fn()
    follow(again)
    expect(watch).toHaveBeenCalledTimes(2)
    expect(again).not.toHaveBeenCalled()
  })
})
