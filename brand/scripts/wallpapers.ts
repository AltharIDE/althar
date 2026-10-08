import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { chromium, type Browser } from '@playwright/test'
import sharp from 'sharp'

import { AURORA, DRAWN_FROM, PAGE, drawnFrom } from '../src/aurora'
import { write } from '../src/files'
import { CARD, PREVIEWS, WALLPAPERS } from '../src/wallpapers'

/* Full quality, and colour kept at full resolution so the dots' edges stay clean. */
const jpeg = (image: Buffer, width?: number, quality = 90): Promise<Buffer> =>
  sharp(image)
    .resize(width === undefined ? {} : { width })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer()

/** Draws the page at a size in a browser, as a PNG. */
async function drawn(browser: Browser, width: number, height: number, theme: string): Promise<Buffer> {
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  /* the launch's own light and dots, not a redraw: the page is handed them, as the banners are handed the mark */
  await tab.addInitScript((aurora) => Object.assign(window, { ALTHAR_AURORA: aurora }), AURORA)
  await tab.goto(`${pathToFileURL(PAGE).href}?w=${width}&h=${height}&theme=${theme}`)
  await tab.waitForFunction(() => document.body.dataset['ready'] === '1', undefined, { timeout: 120_000 })
  const shot = await tab.screenshot({ type: 'png' })
  await tab.close()
  return shot
}

/** Draws each wallpaper and writes it to export/wallpaper/ as a JPEG, with small previews of some and the page's link-preview card. */
export async function exportWallpapers(): Promise<void> {
  const browser = await chromium.launch()
  try {
    for (const w of WALLPAPERS) {
      const shot = await drawn(browser, w.width, w.height, w.theme)
      await write(`wallpaper/${w.file}`, await jpeg(shot))
      for (const p of PREVIEWS)
        if (p.from === w.screen) await write(`wallpaper/aurora-${w.theme}-${w.screen}-preview.jpg`, await jpeg(shot, p.width, 84))
    }
    const card = await drawn(browser, CARD.width, CARD.height, CARD.theme)
    await write('wallpaper/aurora-card.png', await sharp(card).png({ compressionLevel: 9, palette: true, quality: 95 }).toBuffer())
    await writeFile(DRAWN_FROM, `${JSON.stringify(drawnFrom(), null, 2)}\n`)
  } finally {
    await browser.close()
  }
}
