import { describe, expect, it } from 'vitest'

import { AVATAR_SIZE, AVATAR_STYLES, avatarSvg } from '../src/avatar'
import { BOUNDS, GRID } from '../src/geometry'

describe('the avatars', () => {
  it.each(Object.entries(AVATAR_STYLES))('%s is a full square', (_name, style) => {
    const svg = avatarSvg(style)
    expect(svg).toContain(`viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}"`)
    expect(svg).toContain(`<rect width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" fill="${style.ground}"/>`)
  })

  it('keeps the mark inside the circle that fits the square', () => {
    const svg = avatarSvg(AVATAR_STYLES.ink)
    const [, origin, scale] = /translate\(([\d.]+) [\d.]+\) scale\(([\d.]+)\)/.exec(svg) ?? []
    const k = Number(scale)
    const o = Number(origin)
    const centre = AVATAR_SIZE / 2
    for (const [gx, gy] of [
      [BOUNDS.x, BOUNDS.y],
      [BOUNDS.x + BOUNDS.width, BOUNDS.y],
      [BOUNDS.x, BOUNDS.y + BOUNDS.height],
      [BOUNDS.x + BOUNDS.width, BOUNDS.y + BOUNDS.height],
    ] as const) {
      expect(Math.hypot(o + gx * k - centre, o + gy * k - centre)).toBeLessThan(centre * 0.8)
    }
    expect(o + (GRID / 2) * k).toBeCloseTo(centre, 0)
  })

  it('draws at another size', () => {
    expect(avatarSvg(AVATAR_STYLES.paper, 512)).toContain('viewBox="0 0 512 512"')
  })
})
