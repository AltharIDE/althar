/*
 * The sizes a page beside the conversation can be drawn at (ADR-100): the
 * panel's own, the default, or a device's, laid out at the device's size and
 * drawn whole, scaled to fit the panel. A tablet and a phone are also touch
 * screens with a mobile browser's user agent. Pure, so the window and the
 * main process share them.
 */

export type Viewport = 'fit' | 'desktop' | 'laptop' | 'tablet' | 'phone'

export interface Device {
  readonly width: number
  readonly height: number
  /** A touch screen, with a mobile browser's user agent. */
  readonly mobile: boolean
}

export const VIEWPORTS: ReadonlyArray<Viewport> = ['fit', 'desktop', 'laptop', 'tablet', 'phone']

export const DEVICES: Readonly<Record<Exclude<Viewport, 'fit'>, Device>> = {
  desktop: { width: 1440, height: 900, mobile: false },
  laptop: { width: 1280, height: 800, mobile: false },
  tablet: { width: 820, height: 1180, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
}

export const isViewport = (value: unknown): value is Viewport =>
  typeof value === 'string' && (VIEWPORTS as ReadonlyArray<string>).includes(value)

/** A device's size, or null for the panel's own. */
export const deviceOf = (viewport: Viewport): Device | null => (viewport === 'fit' ? null : DEVICES[viewport])

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Room left round a device's page inside the panel, so it reads as drawn in a well, not cut off at the panel's edge. */
export const WELL = 16

/**
 * Where the page goes in the panel, and how much smaller it is drawn: the
 * panel itself for its own size; else the device's size, scaled down to fit
 * inside the panel's well (never up), centred across and at the top.
 */
export const placed = (panel: Rect, viewport: Viewport): { readonly rect: Rect; readonly scale: number } => {
  const device = deviceOf(viewport)
  if (device === null) return { rect: panel, scale: 1 }
  const room = { width: Math.max(1, panel.width - WELL * 2), height: Math.max(1, panel.height - WELL * 2) }
  const scale = Math.min(1, room.width / device.width, room.height / device.height)
  const width = Math.max(1, Math.round(device.width * scale))
  const height = Math.max(1, Math.round(device.height * scale))
  return {
    rect: { x: panel.x + Math.round((panel.width - width) / 2), y: panel.y + WELL, width, height },
    scale,
  }
}

/**
 * A mobile browser's user agent on this Chromium: Chrome on Android, a phone
 * with "Mobile" in it and a tablet without, as Chrome itself says them, so
 * a site serves what it serves those, on the engine that really draws it.
 */
export const mobileAgent = (chrome: string, device: Device): string =>
  `Mozilla/5.0 (Linux; Android 14; ${device.width < 600 ? 'Pixel 8' : 'Pixel Tablet'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}${device.width < 600 ? ' Mobile' : ''} Safari/537.36`

/** Electron's own user agent, as Chrome's: without Electron's and the app's names, which some sites refuse to serve. */
export const browserAgent = (fallback: string): string =>
  fallback
    .replace(/\s(?:Electron|althar|Althar|@althar\/desktop)\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
