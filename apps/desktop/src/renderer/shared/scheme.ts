/*
 * Light or dark, as the window's scheme says. The main process sets
 * Electron's nativeTheme by Settings › Appearance (light, dark, or as the
 * system is), and the window's `prefers-color-scheme` follows it, so the
 * window only has to follow that: the kit's tokens go dark under
 * `data-theme="dark"` on the root. Set before anything draws, so the first
 * frame is already in the right scheme, and kept while the scheme changes.
 */

/** Follows the scheme onto `root`; returns what stops it. */
export const followScheme = (
  root: HTMLElement = document.documentElement,
  media: MediaQueryList = window.matchMedia('(prefers-color-scheme: dark)'),
): (() => void) => {
  const apply = () => {
    root.dataset.theme = media.matches ? 'dark' : 'light'
  }
  apply()
  media.addEventListener('change', apply)
  return () => media.removeEventListener('change', apply)
}
