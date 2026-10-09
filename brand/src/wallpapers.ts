/*
 * The wallpapers: the launch's light, held at the moment the mark has set
 * (wallpapers/aurora.html), in light and dark, at the size of each kind of
 * screen. A screen of another size fills itself from the nearest one; the
 * drawing keeps to its middle, so the crop only takes edges of the light.
 */

export type Theme = 'light' | 'dark'

export interface Screen {
  key: string
  width: number
  height: number
  /** What it's for, for the README table. */
  use: string
}

export const THEMES: readonly Theme[] = ['light', 'dark']

export const SCREENS: readonly Screen[] = [
  { key: 'mac', width: 3456, height: 2234, use: "A Mac's own screen, MacBook Air or Pro" },
  { key: 'display', width: 5120, height: 2880, use: 'A 16:9 display, up to 5K' },
  { key: 'phone', width: 1290, height: 2796, use: 'A phone' },
]

/** Small ones in each theme, made from these screens', for showing the wallpaper on a page: `aurora-<theme>-<from>-preview.jpg`. */
export const PREVIEWS = [
  { from: 'mac', width: 1600 },
  { from: 'phone', width: 600 },
] as const

/** The link preview for the page that offers them, drawn at its own size: `aurora-card.png`. */
export const CARD = { width: 1200, height: 630, theme: 'light' } as const

export interface Wallpaper {
  file: string
  /** Which of SCREENS it is for. */
  screen: string
  theme: Theme
  width: number
  height: number
}

export const WALLPAPERS: readonly Wallpaper[] = SCREENS.flatMap((s) =>
  THEMES.map((theme) => ({ file: `aurora-${theme}-${s.key}.jpg`, screen: s.key, theme, width: s.width, height: s.height })),
)
