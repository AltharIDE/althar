import { Menu, type MenuItemConstructorOptions } from 'electron'

/*
 * The app's menu: Electron's own, as it was before Althar set one, with
 * Check for Updates… under About on a Mac, where the app updates (ADR-024),
 * and Help holding what Althar adds there in place of Electron's links:
 * Report a problem (DEV-61), which opens the dialog in the window the person
 * is in.
 */

// A Mac's menus are in title case; elsewhere, as the window's words are.
export const menuText = {
  checkForUpdates: 'Check for Updates…',
  report: (mac: boolean) => (mac ? 'Report a Problem…' : 'Report a problem…'),
}

export const setAppMenu = ({
  name,
  checkForUpdates,
  report,
}: {
  readonly name: string
  readonly checkForUpdates?: () => void
  readonly report: () => void
}) => {
  const mac = process.platform === 'darwin'
  const check: ReadonlyArray<MenuItemConstructorOptions> =
    checkForUpdates === undefined ? [] : [{ label: menuText.checkForUpdates, click: () => checkForUpdates() }]
  const template: Array<MenuItemConstructorOptions> = [
    ...(mac
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
    { role: 'help', submenu: [{ id: 'report', label: menuText.report(mac), click: () => report() }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
