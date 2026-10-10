import type { NativeImage } from 'electron'
import { describe, expect, it } from 'vitest'

import { hidesAppMenu, windowOptions } from '../src/main/windowOptions'

/* Stands in for the resized picture main.ts hands in; the tests judge where it lands, not the pixels. */
const icon = {} as NativeImage

describe('the window’s chrome, by platform', () => {
  it('keeps macOS’s inset title bar and traffic lights', () => {
    expect(windowOptions('darwin', icon)).toEqual({
      backgroundColor: '#f4f2ec',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 14 },
    })
  })

  it('goes frameless elsewhere, with Althar’s icon on Linux', () => {
    expect(windowOptions('linux', icon)).toEqual({ backgroundColor: '#f4f2ec', frame: false, icon })
    expect(windowOptions('win32', icon)).toEqual({ backgroundColor: '#f4f2ec', frame: false })
  })

  it('takes the app menu away everywhere but macOS', () => {
    expect(hidesAppMenu('darwin')).toBe(false)
    expect(hidesAppMenu('linux')).toBe(true)
    expect(hidesAppMenu('win32')).toBe(true)
  })
})
