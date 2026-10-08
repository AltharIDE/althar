import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'
import sharp from 'sharp'

import { BANNERS } from '../src/banners'
import { write } from '../src/files'
import { BORE, SECTION } from '../src/geometry'

const page = resolve(import.meta.dirname, '../banners/printed.html')

/** Draws each banner in a browser, and writes it to export/ as a PNG. Pass names to draw only those. */
export async function exportBanners(names: readonly string[] = []): Promise<void> {
  const browser = await chromium.launch()
  try {
    for (const b of BANNERS.filter((b) => names.length === 0 || names.includes(b.file))) {
      const tab = await browser.newPage({ viewport: { width: b.width, height: b.height }, deviceScaleFactor: b.scale })
      await tab.addInitScript((mark) => Object.assign(window, { ALTHAR_MARK: mark }), { SECTION, BORE })
      await tab.goto(`${pathToFileURL(page).href}?w=${b.width}&h=${b.height}&layout=${b.layout}&scale=${b.scale}`)
      /* it draws on canvases once its fonts are in, and says when it's done */
      await tab.waitForFunction(() => document.body.dataset['ready'] === '1', undefined, { timeout: 60_000 })
      const shot = await tab.screenshot({ type: 'png' })
      const png = (width?: number): Promise<Buffer> =>
        sharp(shot)
          .resize(width === undefined ? {} : { width })
          .png({ compressionLevel: 9, palette: true, quality: 95 })
          .toBuffer()
      if (b.sizes) for (const width of b.sizes) await write(`${b.folder}/${b.file}-${width}.png`, await png(width))
      else await write(`${b.folder}/${b.file}.png`, await png())
      await tab.close()
    }
  } finally {
    await browser.close()
  }
}
