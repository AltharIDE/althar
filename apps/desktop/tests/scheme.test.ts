import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

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
