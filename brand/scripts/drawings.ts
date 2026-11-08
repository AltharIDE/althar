import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'
import sharp from 'sharp'

import { DRAWINGS, type Tone } from '../src/drawings'
import { write } from '../src/files'

const drawn = resolve(import.meta.dirname, '../../apps/site/src/home/bodies/desktop/styled')
/* the site's Inter, inline, as a page set from a string can't load a file */
const inter = `data:font/woff2;base64,${(await readFile(resolve(import.meta.dirname, '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'))).toString('base64')}`

/** The landing page's tile, alone: the drawing on its own stage, in one tone, still. */
const page = (source: string, tone: Tone, width: number): string => `<!doctype html><html><head>
<style>
  @font-face { font-family: Inter; src: url('${inter}') format('woff2'); font-weight: 100 900; }
  html, body { margin: 0; }
  .stage { position: relative; width: ${width}px; aspect-ratio: 16 / 10; overflow: hidden; container-type: inline-size; }
</style></head><body><div class="stage" data-tone="${tone}"></div></body></html>`

/** Draws each of the landing page's feature drawings, light and dark, in its reduced-motion still, and writes it to export/drawings. Pass names to draw only those. */
export async function exportDrawings(names: readonly string[] = []): Promise<void> {
  const browser = await chromium.launch()
  try {
    for (const d of DRAWINGS.filter((d) => names.length === 0 || names.includes(d.file))) {
      const source = await readFile(resolve(drawn, `d-${d.file}.html`), 'utf8')
      for (const tone of ['light', 'dark'] as const) {
        const tab = await browser.newPage({
          viewport: { width: d.width, height: (d.width * 10) / 16 },
          deviceScaleFactor: 2,
          reducedMotion: 'reduce',
        })
        await tab.setContent(page(source, tone, d.width))
        /* as the site's Fragment does: its style in the head, its root in the stage, its script after it */
        await tab.evaluate((source) => {
          const parts = document.createElement('template')
          parts.innerHTML = source
          for (const style of parts.content.querySelectorAll('style')) document.head.appendChild(style)
          const scripts = [...parts.content.querySelectorAll('script')]
          for (const script of scripts) script.remove()
          const stage = document.querySelector('.stage')!
          stage.appendChild(parts.content)
          for (const script of scripts) {
            const run = document.createElement('script')
            run.textContent = script.textContent
            stage.appendChild(run)
          }
        }, source)
        await tab.evaluate(() => document.fonts.ready)
        await tab.waitForTimeout(800)
        const shot = await tab.locator('.stage').screenshot({ type: 'png' })
        await write(
          `drawings/${d.file}${tone === 'dark' ? '-dark' : ''}.jpg`,
          await sharp(shot).jpeg({ quality: 86, mozjpeg: true }).toBuffer(),
        )
        await tab.close()
      }
    }
  } finally {
    await browser.close()
  }
}

if (import.meta.main) await exportDrawings(process.argv.slice(2))
