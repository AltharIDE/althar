import type { NativeImage } from 'electron'
import { describe, expect, it } from 'vitest'

import { appMenu, windowOptions } from '../src/main/windowOptions'

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

  it('keeps a trimmed menu off a Mac for its accelerators, and leaves macOS’s own menu bar alone', () => {
    expect(appMenu('darwin', true)).toBeNull()
    const menu = appMenu('linux', false)
    expect(menu?.map((item) => item.label)).toEqual(['File', 'Edit', 'View'])
    const roles = menu?.flatMap((item) => (Array.isArray(item.submenu) ? item.submenu.map((entry) => entry.role) : []))
    expect(roles).toEqual(expect.arrayContaining(['quit', 'undo', 'copy', 'paste', 'zoomIn', 'zoomOut', 'togglefullscreen']))
    // Reload and devtools are for developing only.
    expect(roles).not.toContain('toggleDevTools')
    expect(
      appMenu('win32', true)?.flatMap((item) => (Array.isArray(item.submenu) ? item.submenu.map((entry) => entry.role) : [])),
    ).toContain('toggleDevTools')
  })
})
