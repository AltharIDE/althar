import italic from '@fontsource-variable/inter/files/inter-latin-opsz-italic.woff2?url'
import normal from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url'

/*
 * Inter at its display optical size, as its own family, for the first
 * screen's headline and the headings set like it: tighter and sharper at
 * 100px than the text cut the rest of the site sets. Registered once, when
 * the home page loads.
 */

export const DISPLAY = 'Inter Display'

let added = false
export const addDisplay = () => {
  if (added || typeof document === 'undefined') return
  added = true
  for (const [src, style] of [
    [normal, 'normal'],
    [italic, 'italic'],
  ] as const) {
    const face = new FontFace(DISPLAY, `url(${src}) format('woff2')`, { weight: '100 900', style, display: 'swap' })
    document.fonts.add(face)
    void face.load()
  }
}
