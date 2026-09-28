import { describe, expect, it } from 'vitest'

import { frames, glide, path, transform } from '../src/screens/Welcome/camera'

const at = (x: number, y: number, s: number) => ({ x, y, s })

describe('the camera', () => {
  it('flies from one view to the other, pulling back on the way', () => {
    const a = at(1400, 1300, 0.9)
    const b = at(2650, 1000, 1)
    const { ms, at: along } = path(a, b, 1000)
    expect(along(0).x).toBeCloseTo(a.x)
    expect(along(0).s).toBeCloseTo(a.s)
    expect(along(1).x).toBeCloseTo(b.x)
    expect(along(1).y).toBeCloseTo(b.y)
    expect(along(1).s).toBeCloseTo(b.s)
    expect(along(0.5).s).toBeLessThan(0.9)
    expect(ms).toBeGreaterThanOrEqual(1500)
    expect(ms).toBeLessThanOrEqual(2300)
  })

  it('zooms straight in when there is no distance to cross, without leaning', () => {
    const a = at(2000, 1500, 0.25)
    const b = at(2000, 1500, 0.8)
    expect(path(a, b, 1000).at(1).s).toBeCloseTo(0.8)
    const f = frames(a, b, { fx: 600, fy: 400 }, { fx: 700, fy: 400 }, 1000, [4, 1])
    expect(
      f.tilt.every((k) => k.transform === 'rotateX(0.000deg) rotateZ(-0.000deg)' || k.transform === 'rotateX(0.000deg) rotateZ(0.000deg)'),
    ).toBe(true)
    /* the line weight thins with the zoom, from the table's to a stop's */
    expect(f.world[0]!['--far']).toBe('4')
    expect(Number(f.world.at(-1)!['--far'])).toBeCloseTo(1)
    expect(f.world.at(-1)!.transform).toBe(transform(b, { fx: 700, fy: 400 }))
  })

  it('leans most at the height of a flight, and leaves the line weight alone between stops', () => {
    const f = frames(at(1400, 1300, 0.9), at(2650, 1000, 1), { fx: 800, fy: 400 }, { fx: 800, fy: 400 }, 1000, [1, 1])
    const lean = f.tilt.map((k) => Number(/rotateX\(([-\d.]+)deg\)/.exec(String(k.transform))![1]))
    const top = lean.indexOf(Math.max(...lean))
    expect(lean[0]).toBe(0)
    expect(lean.at(-1)).toBeCloseTo(0)
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThan(lean.length - 1)
    expect(f.world.some((k) => '--far' in k)).toBe(false)
  })

  describe('gliding', () => {
    const a = at(1400, 1300, 0.9)
    const b = at(2650, 1000, 1)
    const fa = { fx: 800, fy: 400 }
    /* a route that bends away from the straight way and back */
    const via = [
      { x: 1700, y: 1300 },
      { x: 1900, y: 1500 },
      { x: 2100, y: 1400 },
      { x: 2300, y: 1000 },
    ]
    const f = glide(a, b, fa, fa, [1, 1], via)
    const turned = (k: Keyframe, axis: 'X' | 'Y') => Number(new RegExp(`rotate${axis}\\(([-\\d.]+)deg\\)`).exec(String(k.transform))![1])
    const size = f.tilt.map((k) => Math.hypot(turned(k, 'X'), turned(k, 'Y')))
    /* where the camera is looking, read back from the table's transform */
    const seen = f.world.map((k) => {
      const [tx, ty, s] = /translate3d\(([-\d.e]+)px, ([-\d.e]+)px, 0\) scale\(([-\d.e]+)\)/.exec(String(k.transform))!.slice(1).map(Number)
      return { x: (fa.fx - tx!) / s!, y: (fa.fy - ty!) / s! }
    })

    it('keeps its own pace, and lands exactly where the camera rests', () => {
      expect(f.easing).toBe('linear')
      expect(f.world[0]!.transform).toBe(transform(a, fa))
      expect(f.world.at(-1)!.transform).toBe(transform(b, fa))
    })

    it('goes straight, however the route bends, and never rolls', () => {
      const off = seen.map((c) => Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y))
      expect(Math.max(...off)).toBeLessThan(0.5)
      expect(f.tilt.every((k) => !String(k.transform).includes('rotateZ'))).toBe(true)
    })

    it('tips toward where it is going on the way, and not at either end', () => {
      expect(size[0]).toBeCloseTo(0)
      expect(size.at(-1)).toBeCloseTo(0)
      expect(Math.max(...size)).toBeGreaterThan(20)
      /* heading right and up: the right falls away, and the top */
      const mid = f.tilt[f.tilt.length >> 1]!
      expect(turned(mid, 'Y')).toBeGreaterThan(0)
      expect(turned(mid, 'X')).toBeGreaterThan(0)
    })

    it('draws the route level with the camera, from none of it to all of it', () => {
      const drawn = f.drawn!
      expect(drawn[0]).toBe(0)
      expect(drawn.at(-1)).toBe(1)
      expect(drawn.every((u, i) => i === 0 || u >= drawn[i - 1]!)).toBe(true)
      /* nothing is drawn until the camera comes level with where the route starts */
      const reach = seen.findIndex((c) => c.x >= via[0]!.x - 1)
      expect(drawn.slice(0, reach - 1).every((u) => u === 0)).toBe(true)
    })

    it('draws nothing with no route, and carries the line weight', () => {
      const c = at(1000, 1000, 1)
      const g = glide(c, c, fa, fa, [1, 2], [])
      expect(g.world.at(-1)!.transform).toBe(transform(c, fa))
      expect(g.world.at(-1)!['--far']).toBe('2')
      expect(g.drawn!.every((u) => u === 0)).toBe(true)
    })
  })
})
