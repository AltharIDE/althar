import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import sharp from 'sharp'

import type { Raster, Written } from './catalog'

/** The folder the pack is written to. */
export const EXPORT = resolve(import.meta.dirname, '../export')

export async function write(file: string, content: string | Uint8Array): Promise<void> {
  const target = resolve(EXPORT, file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
}

export const writeAll = (files: readonly Written[]): Promise<void[]> => Promise.all(files.map((f) => write(f.file, f.content)))

/** An SVG as a PNG `width` wide, drawn at a density that keeps its edges sharp. */
export async function png(svg: string, width: number, background?: string): Promise<Buffer> {
  const box = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) [\d.-]+"/.exec(svg)
  const units = Number(box?.[1] ?? width)
  let image = sharp(Buffer.from(svg), { density: Math.max(72, Math.ceil((72 * width) / units)) }).resize({ width })
  if (background) image = image.flatten({ background })
  return image.png({ compressionLevel: 9 }).toBuffer()
}

export async function rasterise(rasters: readonly Raster[], files: readonly Written[]): Promise<void> {
  const source = new Map(files.map((f) => [f.file, f.content]))
  for (const r of rasters) {
    const svg = source.get(r.from)
    if (svg === undefined) throw new Error(`${r.file}: no ${r.from} to make it from`)
    await write(r.file, await png(svg, r.width, r.background))
  }
}
