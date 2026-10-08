import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { BASELINE, BORE, BOUNDS, GRID, SECTION } from '../src/geometry'

describe('the mark', () => {
  it('covers the bounds it states', async () => {
    const unit = 100
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}"><path fill-rule="evenodd" d="${SECTION}${BORE}"/></svg>`
    const { data, info } = await sharp(Buffer.from(svg), { density: 72 * unit })
      .resize(GRID * unit)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let minX = info.width
    let minY = info.height
    let maxX = 0
    let maxY = 0
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if ((data[(y * info.width + x) * 4 + 3] ?? 0) > 127) {
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        }
      }
    }
    expect(minX / unit).toBeCloseTo(BOUNDS.x, 1)
    expect((maxX + 1) / unit).toBeCloseTo(BOUNDS.x + BOUNDS.width, 1)
    expect(minY / unit).toBeCloseTo(BOUNDS.y, 1)
    expect((maxY + 1) / unit).toBeCloseTo(BOUNDS.y + BOUNDS.height, 1)
  })

  it('stands on the baseline', () => {
    expect(BOUNDS.y + BOUNDS.height).toBeCloseTo(BASELINE, 5)
  })
})
