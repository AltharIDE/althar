import { Menu, type MenuItemConstructorOptions } from 'electron'

/*
 * The app's menu: Electron's own (the app, File, Edit, View, Window), with
 * Help holding what Althar adds there: Report a problem (DEV-61), which
 * opens the dialog in the window the person is in.
 */

export const setAppMenu = ({ report }: { readonly report: () => void }) => {
  const mac = process.platform === 'darwin'
  const template: Array<MenuItemConstructorOptions> = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    // A Mac's menus are in title case; elsewhere, as the window's words are.
    { role: 'help', submenu: [{ id: 'report', label: mac ? 'Report a Problem…' : 'Report a problem…', click: report }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
