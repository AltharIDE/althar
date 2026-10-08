import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { catalog } from '../src/catalog'

describe('the catalog', async () => {
  const { files, rasters } = await catalog()

  it('names every file once', () => {
    const all = [...files.map((f) => f.file), ...rasters.map((r) => r.file)]
    expect(new Set(all).size).toBe(all.length)
  })

  it('makes each PNG from an SVG it lists', () => {
    const svgs = new Set(files.map((f) => f.file))
    for (const r of rasters) expect(svgs.has(r.from), r.file).toBe(true)
  })

  it('draws SVGs a renderer accepts, and says what they are', async () => {
    for (const f of files.filter((f) => f.file.endsWith('.svg'))) {
      const meta = await sharp(Buffer.from(f.content)).metadata()
      expect(meta.width, f.file).toBeGreaterThan(0)
      expect(f.content, f.file).toMatch(/aria-label="[^"]+"/)
    }
  })

  it('keeps raster names in step with their widths', () => {
    for (const r of rasters) {
      const stated = /-(\d+)\.png$/.exec(r.file)
      if (stated) expect(Number(stated[1]), r.file).toBe(r.width)
    }
  })
})
