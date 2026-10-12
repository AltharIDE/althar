import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { glassDrop } from '../src/shared/glassDrop'

/*
 * The nav's drop, driven by hand: a row of items at known offsets, frames
 * run on demand, and reduced motion on, so the drop goes straight where it
 * is aimed and its place can be read from its transform.
 */

/** Half the drop's width, as glassDrop has it. */
const HALF = 60

type Fake = { style: Record<string, string> }
const fake = (): Fake => ({ style: {} })

function rig() {
  const row = fake()
  const items = [0, 1, 2].map((i) => ({ ...fake(), offsetLeft: 100 + i * 80, offsetWidth: 60, offsetParent: row }))
  const glass = [fake(), fake()]
  const fall = fake()
  const drop = { ...fake(), querySelectorAll: () => glass, querySelector: () => fall }
  Object.assign(row, { querySelectorAll: () => items })
  return { row, items, drop }
}

let frames: FrameRequestCallback[] = []
let now = 0
const run = () => {
  for (let n = 0; n < 20 && frames.length; n++) {
    const queued = frames
    frames = []
    now += 16
    for (const f of queued) f(now)
  }
}

beforeEach(() => {
  frames = []
  now = 0
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 })
  vi.stubGlobal('document', {})
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('the nav’s glass drop', () => {
  it('follows keyboard focus away from where the pointer rests, and goes back to it when focus leaves', () => {
    const { row, items, drop } = rig()
    const at = (i: number) => `translate3d(${items[i]!.offsetLeft + 30 - HALF}px, 0, 0)`
    const lens = glassDrop(row as unknown as HTMLElement, drop as unknown as HTMLElement)

    lens.point(items[0] as unknown as Element)
    run()
    expect(drop.style.transform).toContain(at(0))

    // The pointer stays on the first; Tab moves on through the others.
    lens.focus(items[1] as unknown as Element)
    run()
    expect(drop.style.transform).toContain(at(1))
    lens.focus(null)
    lens.focus(items[2] as unknown as Element)
    run()
    expect(drop.style.transform).toContain(at(2))

    // Focus leaves the nav: back under the pointer.
    lens.focus(null)
    run()
    expect(drop.style.transform).toContain(at(0))

    // Pointing at another takes it back from focus.
    lens.focus(items[2] as unknown as Element)
    lens.point(items[1] as unknown as Element)
    run()
    expect(drop.style.transform).toContain(at(1))
    lens.stop()
  })
})
