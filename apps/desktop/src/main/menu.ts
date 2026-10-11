import { Menu, type MenuItemConstructorOptions } from 'electron'

/*
 * The app's menu: Electron's own, as it was before Althar set one, with
 * Check for Updates… under About on a Mac, where the app updates (ADR-024),
 * and without Electron's Help, whose links are Electron's.
 */

export const menuText = { checkForUpdates: 'Check for Updates…' }

export const setAppMenu = ({ name, checkForUpdates }: { readonly name: string; readonly checkForUpdates?: () => void }) => {
  const check: ReadonlyArray<MenuItemConstructorOptions> =
    checkForUpdates === undefined ? [] : [{ label: menuText.checkForUpdates, click: () => checkForUpdates() }]
  const template: Array<MenuItemConstructorOptions> = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: name,
            submenu: [
              { role: 'about' },
              ...check,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ] satisfies Array<MenuItemConstructorOptions>,
          },
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
