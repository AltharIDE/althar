import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { AVATAR_SIZE, AVATAR_STYLES, avatarSvg } from '../src/avatar'
import { BASELINE, BORE, BOUNDS, GRID, SECTION } from '../src/geometry'
import { ico } from '../src/ico'
import { EM, outline } from '../src/lockup'

/* The numbers other drawings are built on: if one is wrong, everything placed by it is quietly off. */

describe('the mark', () => {
  it('covers the bounds the lockups and avatars are placed by', async () => {
    const unit = 100
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}"><path fill-rule="evenodd" d="${SECTION}${BORE}"/></svg>`
    const { data, info } = await sharp(Buffer.from(svg), { density: 72 * unit })
      .resize(GRID * unit)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let [minX, minY, maxX, maxY] = [info.width, info.height, 0, 0]
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if ((data[(y * info.width + x) * 4 + 3] ?? 0) > 127) {
          ;[minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)]
        }
      }
    }
    expect([minX / unit, minY / unit, (maxX + 1) / unit, (maxY + 1) / unit].map((v) => Math.round(v * 10) / 10)).toEqual(
      [BOUNDS.x, BOUNDS.y, BOUNDS.x + BOUNDS.width, BOUNDS.y + BOUNDS.height].map((v) => Math.round(v * 10) / 10),
    )
    expect(BOUNDS.y + BOUNDS.height).toBeCloseTo(BASELINE, 5)
  })
})

describe('the wordmark', () => {
  it('is set as the browser sets it: Inter at 650, tracked tight', async () => {
    const { left, right, top } = await outline('Althar')
    /* 300px of Inter at 650 with -0.045em tracking spans 2.543em in Chromium, with capitals 0.727em tall */
    expect((right - left) / EM).toBeCloseTo(2.55, 1)
    expect(top / EM).toBeCloseTo(0.727, 1)
  })
})

describe('the avatars', () => {
  it('keep the mark inside the circle that fits the square, where a place cuts one', () => {
    for (const style of Object.values(AVATAR_STYLES)) {
      const [, origin, scale] = /translate\(([\d.]+) [\d.]+\) scale\(([\d.]+)\)/.exec(avatarSvg(style)) ?? []
      const [o, k, centre] = [Number(origin), Number(scale), AVATAR_SIZE / 2]
      for (const [gx, gy] of [
        [BOUNDS.x, BOUNDS.y],
        [BOUNDS.x + BOUNDS.width, BOUNDS.y],
        [BOUNDS.x, BOUNDS.y + BOUNDS.height],
        [BOUNDS.x + BOUNDS.width, BOUNDS.y + BOUNDS.height],
      ]) {
        expect(Math.hypot(o + (gx ?? 0) * k - centre, o + (gy ?? 0) * k - centre)).toBeLessThan(centre * 0.8)
      }
    }
  })
})

describe('the favicon', () => {
  it('is an icon file around one PNG', () => {
    const png = Buffer.from([1, 2, 3, 4])
    const out = Buffer.from(ico(png, 32))
    expect([out.readUInt16LE(2), out.readUInt16LE(4), out.readUInt8(6), out.readUInt32LE(14), out.readUInt32LE(18)]).toEqual([
      1, 1, 32, 4, 22,
    ])
    expect(out.subarray(22)).toEqual(png)
  })
})
