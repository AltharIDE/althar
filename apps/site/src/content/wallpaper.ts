/*
 * The wallpaper page: Aurora, the launch's light held at the moment the mark
 * has set, from the brand pack (brand/export/wallpaper). The build serves the
 * files at /wallpaper/, beside the page.
 */

export const WALLPAPER = {
  title: ['Real ones rock Althar', 'Even with the app closed'],
  lead: 'When Althar starts, a light rises and the mark comes up out of it, dot by dot. This is that moment, held still, in light and dark, for a Mac, a larger display and a phone.',
  themes: [
    {
      key: 'light',
      name: 'Light',
      alt: 'The Aurora wallpaper in light: a cobalt light rising off the bottom of a paper-white screen, the Althar mark above it in dots.',
    },
    {
      key: 'dark',
      name: 'Dark',
      alt: 'The Aurora wallpaper in dark: a cobalt light glowing up from the bottom of a near-black screen, the Althar mark above it in dots.',
    },
  ],
  screens: [
    { key: 'mac', name: 'Mac', size: '3456 × 2234' },
    { key: 'display', name: 'Display', size: '5120 × 2880' },
    { key: 'phone', name: 'Phone', size: '1290 × 2796' },
  ],
  note: 'Mac fits a MacBook’s own screen, Display a 16:9 display up to 5K. A screen of another shape fills itself from the nearest; the mark stays in the middle.',
} as const

/** A wallpaper's file, for a theme and a screen. */
export const wallpaperFile = (theme: string, screen: string) => `/wallpaper/aurora-${theme}-${screen}.jpg`

/** The small one shown on the page, of the Mac's or the phone's. */
export const wallpaperPreview = (theme: string, screen: 'mac' | 'phone') => `/wallpaper/aurora-${theme}-${screen}-preview.jpg`
