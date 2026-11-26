import { describe, expect, it } from 'vite-plus/test'

import { pinnedHeight, progress, trackHeight } from '../src/home/story/scroll'

/*
 * The home page's scenes are sized in windows, and a window is the small one
 * (100svh). On a phone the browser's bar slides away as you scroll, and the
 * window gets taller without the small one changing: nothing sized here may
 * move with it, or the page changes height above the reader.
 */

/** A phone with its browser's bar out, and the same phone once the bar has slid away. */
const SMALL = 700
const BAR_AWAY = 812

describe('a pinned section', () => {
  it('is its picture and its run of windows tall, with its padding on top', () => {
    expect(pinnedHeight(600, 4, SMALL, 80)).toBe(600 + 4 * SMALL + 80)
  })

  it('is two windows tall at least', () => {
    expect(pinnedHeight(100, 0.5, SMALL, 0)).toBe(2 * SMALL)
  })

  it('starts as it pins and ends as it lets go, wherever the browser\u2019s bar is', () => {
    const height = pinnedHeight(600, 4, SMALL, 0)
    expect(progress(false, 0, height, SMALL)).toBe(0)
    expect(progress(false, -(height - SMALL) / 2, height, SMALL)).toBeCloseTo(0.5)
    expect(progress(false, -(height - SMALL), height, SMALL)).toBe(1)
  })
})

describe('a track', () => {
  it('is a window tall and as far as its row runs', () => {
    expect(trackHeight(1800, SMALL)).toBe(SMALL + 1800)
  })

  it('has run its whole row once all but a window of it has scrolled by', () => {
    const height = trackHeight(1800, SMALL)
    expect(progress(false, -900, height, SMALL)).toBeCloseTo(0.5)
    expect(progress(false, -1800, height, SMALL)).toBe(1)
    expect(progress(false, -2400, height, SMALL)).toBe(1)
  })
})

describe('the browser\u2019s bar sliding away', () => {
  it('changes no section\u2019s height: they are sized by the small window, which it leaves alone', () => {
    // What the page did before: sized by the window as it was, each section lost this much as the bar came back.
    expect(pinnedHeight(600, 4, BAR_AWAY, 0) - pinnedHeight(600, 4, SMALL, 0)).toBe(4 * (BAR_AWAY - SMALL))
    expect(trackHeight(1800, BAR_AWAY) - trackHeight(1800, SMALL)).toBe(BAR_AWAY - SMALL)
  })

  it('moves a section coming into the window only as its top moves', () => {
    expect(progress(true, BAR_AWAY, 500, BAR_AWAY)).toBe(0)
    expect(progress(true, 0, 500, BAR_AWAY)).toBe(1)
    expect(progress(true, SMALL / 2, 500, SMALL)).toBeCloseTo(0.5)
  })
})
