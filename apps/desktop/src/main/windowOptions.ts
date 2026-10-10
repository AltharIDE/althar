import type { NativeImage } from 'electron'

/*
 * How the window is dressed, by platform. macOS keeps its inset title bar
 * and the system's traffic lights; elsewhere the strip the tabs draw is the
 * window's own chrome, and on Linux the window manager reads the app's icon
 * from here (main.ts gives it already small: 256px and up silently overflow
 * X11's property size and leave the window iconless). The paper under the
 * page is the same everywhere, so nothing else shows before its first frame.
 */

export const windowOptions = (platform: NodeJS.Platform, icon: NativeImage) => ({
  backgroundColor: '#f4f2ec',
  ...(platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 14 } }
    : { frame: false, ...(platform === 'linux' ? { icon } : {}) }),
})

/** Whether the app's menu is taken away: off a Mac the window keeps none, on macOS the system's menu bar stays. */
export const hidesAppMenu = (platform: NodeJS.Platform): boolean => platform !== 'darwin'
