/* Builds the pitch's raster images. Run after changing a source: bun run images
     src/assets/{board,conversation}.png -> AVIF and WebP at a few widths
     public/favicon.svg                  -> favicon.ico, apple-touch-icon, manifest icons
     scripts/og.html                     -> public/og.png, the 1200×630 social card
     scripts/readme-header.html          -> docs/assets/readme-header.png, the repo README's banner at 2× */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const pub = resolve(root, 'public')

/* ---- screenshots ---- */
const SHOTS = [
  { name: 'board', widths: [720, 1080, 1440] },
  { name: 'conversation', widths: [500, 760, 1000] },
]
const out = resolve(root, 'src/assets/img')
await mkdir(out, { recursive: true })
for (const { name, widths } of SHOTS) {
  const src = resolve(root, `src/assets/${name}.png`)
  for (const w of widths) {
    const img = sharp(src).resize({ width: w, withoutEnlargement: true })
    await img.clone().avif({ quality: 62, effort: 7 }).toFile(`${out}/${name}-${w}.avif`)
    await img.clone().webp({ quality: 82, effort: 6 }).toFile(`${out}/${name}-${w}.webp`)
  }
}

/* ---- icons ---- */
const svg = await readFile(`${pub}/favicon.svg`)
const png = (size: number): Promise<Buffer> =>
  sharp(svg, { density: Math.ceil((size / 16) * 72) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()
for (const [file, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
] as const) {
  await writeFile(`${pub}/${file}`, await png(size))
}
/* A one-image .ico wrapping a 32px PNG, which every browser that asks for /favicon.ico understands. */
const ico32 = await png(32)
const head = Buffer.alloc(22)
head.writeUInt16LE(0, 0)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(1, 4)
head.writeUInt8(32, 6)
head.writeUInt8(32, 7)
head.writeUInt16LE(1, 10)
head.writeUInt16LE(32, 12)
head.writeUInt32LE(ico32.length, 14)
head.writeUInt32LE(22, 18)
await writeFile(`${pub}/favicon.ico`, Buffer.concat([head, ico32]))

/* ---- social card ---- */
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.goto(pathToFileURL(resolve(root, 'scripts/og.html')).href)
  await page.evaluate(() => document.fonts.ready)
  const shot = await page.screenshot({ type: 'png' })
  await sharp(shot).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(`${pub}/og.png`)

  /* ---- README banner ---- */
  const docs = resolve(root, '../../docs/assets')
  await mkdir(docs, { recursive: true })
  const banner = await browser.newPage({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 2 })
  await banner.goto(pathToFileURL(resolve(root, 'scripts/readme-header.html')).href)
  /* it draws on canvases once its fonts are in, and says when it's done */
  await banner.waitForFunction(() => document.body.dataset.ready === '1')
  const header = await banner.screenshot({ type: 'png' })
  await sharp(header).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(`${docs}/readme-header.png`)
} finally {
  await browser.close()
}

console.warn('images: done')
