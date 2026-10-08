import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Draws the menu bar's pictures into resources/tray: Althar's mark, and the
 * mark with a dot for when something waits on you, as template images (black
 * on clear: the menu bar draws them in its own colour), at 18 points and
 * twice that. The mark's geometry is the kit's Logo (a test keeps the two
 * the same). Run it again after the mark changes:
 *   node scripts/trayPictures.ts
 */

/** The kit's LOGO_SECTION and LOGO_BORE, on the 24 grid. */
export const SECTION =
  'M12.42 5.53A15.36 15.36 0 0 0 19.89 18.47L19.47 19.2A15.36 15.36 0 0 0 4.53 19.2L4.11 18.47A15.36 15.36 0 0 0 11.58 5.53Z'
export const BORE = 'M10.2 14.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0Z'
/** The kit's point, in the bore. */
export const POINT = { cx: 12, cy: 14.4, r: 0.8 }

const SIZE = 18
/** The dot that says something waits on you: at the top right, with clear round it so it reads apart from the mark. */
const DOT = { cx: 19.4, cy: 5.2, r: 3, clear: 1.6 }

const svg = (yours: boolean) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${SIZE}" height="${SIZE}">
  <defs>
    <mask id="room">
      <rect width="24" height="24" fill="white" />
      ${yours ? `<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r + DOT.clear}" fill="black" />` : ''}
    </mask>
  </defs>
  <g mask="url(#room)">
    <path d="${SECTION}${BORE}" fill-rule="evenodd" />
    <circle cx="${POINT.cx}" cy="${POINT.cy}" r="${POINT.r}" />
  </g>
  ${yours ? `<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" />` : ''}
</svg>`

if (import.meta.main) {
  const out = join(import.meta.dirname, '..', 'resources', 'tray')
  mkdirSync(out, { recursive: true })
  // Only when drawing: a test reads the geometry above without a browser.
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: scale })
    for (const yours of [false, true]) {
      await page.setContent(`<body style="margin:0;background:transparent">${svg(yours)}</body>`)
      const picture = await page.locator('svg').screenshot({ omitBackground: true })
      writeFileSync(join(out, `mark${yours ? 'Yours' : ''}Template${scale === 2 ? '@2x' : ''}.png`), picture)
    }
    await page.close()
  }
  await browser.close()
}
