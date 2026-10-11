import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setAppMenu } from '../src/main/menu'

/* The template the menu was built from, as Electron would be given it. */
const built = vi.hoisted(() => ({ template: [] as Array<MenuItemConstructorOptions> }))
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: Array<MenuItemConstructorOptions>) => {
      built.template = template
      return template
    },
    setApplicationMenu: () => undefined,
  },
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')
const on = (system: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: system })
afterEach(() => {
  if (platform !== undefined) Object.defineProperty(process, 'platform', platform)
})

const items = (menu: MenuItemConstructorOptions | undefined) =>
  Array.isArray(menu?.submenu) ? (menu.submenu as Array<MenuItemConstructorOptions>) : []
/* A click, as Electron makes one: the item's own handler, which needs nothing of what Electron passes it here. */
const click = (item: MenuItemConstructorOptions | undefined) => (item?.click as (() => void) | undefined)?.()

describe('the app menu', () => {
  it('holds Check for Updates… under About on a Mac, and Report a Problem… alone in Help', () => {
    on('darwin')
    const checkForUpdates = vi.fn()
    const report = vi.fn()
    setAppMenu({ name: 'Althar', checkForUpdates, report })

    const [app] = built.template
    expect(app?.label).toBe('Althar')
    expect(items(app).slice(0, 2)).toEqual([{ role: 'about' }, expect.objectContaining({ label: 'Check for Updates…' })])
    click(items(app)[1])
    expect(checkForUpdates).toHaveBeenCalledOnce()

    const help = built.template.find((menu) => menu.role === 'help')
    expect(items(help)).toEqual([expect.objectContaining({ id: 'report', label: 'Report a Problem…' })])
    click(items(help)[0])
    expect(report).toHaveBeenCalledOnce()
  })

  it('has no Check for Updates… where the app doesn’t update, and off a Mac no app menu, with Help in the window’s words', () => {
    on('darwin')
    setAppMenu({ name: 'Althar', report: vi.fn() })
    expect(items(built.template[0]).map((item) => item.label)).not.toContain('Check for Updates…')

    on('linux')
    setAppMenu({ name: 'Althar', report: vi.fn() })
    expect(built.template.map((menu) => menu.role ?? menu.label)).toEqual(['fileMenu', 'editMenu', 'viewMenu', 'windowMenu', 'help'])
    expect(items(built.template.at(-1))[0]?.label).toBe('Report a problem…')
  })
})
