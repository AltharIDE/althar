import type { MenuItemConstructorOptions, NativeImage } from 'electron'

/*
 * How the window is dressed, by platform. macOS keeps its inset title bar
 * and the system's traffic lights; elsewhere the strip the tabs draw is the
 * window's own chrome, and on Linux the window manager reads the app's icon
 * from here (main.ts gives it already small: 256px and up silently overflow
 * X11's property size and leave the window iconless). The paper under the
 * page is the same everywhere, so nothing else shows before its first frame.
 *
 * Off a Mac Electron draws the application menu's bar at the top of every
 * window, frameless or not, so main.ts hides it per window; a trimmed menu is
 * kept for its accelerators only: text zoom, full screen and quit, with
 * reload and devtools while developing.
 */

export const windowOptions = (platform: NodeJS.Platform, icon: NativeImage) => ({
  backgroundColor: '#f4f2ec',
  ...(platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 14 } }
    : { frame: false, ...(platform === 'linux' ? { icon } : {}) }),
})

/** The menu off a Mac: accelerators without a bar; null on macOS, which keeps the system's own menu bar. */
export const appMenu = (platform: NodeJS.Platform, dev: boolean): MenuItemConstructorOptions[] | null =>
  platform === 'darwin'
    ? null
    : [
        { label: 'File', submenu: [{ role: 'quit' }] },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: 'View',
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            ...(dev ? [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }] : []),
          ],
        },
      ]
