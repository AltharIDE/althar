import { describe, expect, it } from 'vitest'

import { frames, glide } from '../src/screens/Welcome/camera'

/* The camera asked to move where it already is: what is left is the line weight, and the route. */

const here = { x: 2000, y: 1500, s: 0.8 }
const focus = { fx: 640, fy: 400 }

describe('the camera staying where it is', () => {
  it('changes the line weight evenly with time when it neither moves nor zooms, and does not lean', () => {
    const f = frames(here, here, focus, focus, 1000, [1, 4])
    const half = f.world.find((k) => k.offset === 0.5)!
    expect(Number(half['--far'])).toBeCloseTo(2)
    expect(f.world.at(-1)!['--far']).toBe('4')
    expect(f.tilt.every((k) => /^rotateX\(0\.000deg\) rotateZ\(-?0\.000deg\)$/.test(String(k.transform)))).toBe(true)
  })

  it('draws a route it glides along without moving all at once, as soon as it sets off', () => {
    const g = glide(
      here,
      here,
      focus,
      focus,
      [1, 1],
      [
        { x: 1800, y: 1500 },
        { x: 2200, y: 1500 },
      ],
    )
    expect(g.drawn![0]).toBe(0)
    expect(g.drawn!.slice(1).every((u) => u === 1)).toBe(true)
  })
})
