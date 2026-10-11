import { describe, expect, it } from 'vitest'

import { revealInScroller } from '../src/lib/focusQuietly'

/* jsdom lays nothing out, so the geometry is given: a 400px scroller at the top of the page, and a target in it */
function setup(top: number, height: number) {
  const box = document.createElement('div')
  box.style.overflowY = 'auto'
  Object.defineProperty(box, 'scrollHeight', { value: 2000 })
  Object.defineProperty(box, 'clientHeight', { value: 400 })
  box.getBoundingClientRect = () => ({ top: 0, bottom: 400, height: 400 }) as DOMRect
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect
  box.append(el)
  document.body.append(box)
  return { box, el }
}

describe('revealInScroller', () => {
  it('leaves a target that is in view where it is, and the page above it too', () => {
    const { box, el } = setup(100, 100)
    revealInScroller(el, 'center')
    revealInScroller(el)
    expect(box.scrollTop).toBe(0)
    expect(document.documentElement.scrollTop).toBe(0)
  })

  it('scrolls only the scroller, to the nearest edge', () => {
    const { box, el } = setup(350, 150)
    revealInScroller(el)
    expect(box.scrollTop).toBe(100)
  })

  it('centers a target that is out of view, and starts a taller one at its top', () => {
    const out = setup(600, 100)
    revealInScroller(out.el, 'center')
    expect(out.box.scrollTop).toBe(450)
    const tall = setup(50, 1000)
    revealInScroller(tall.el, 'center')
    expect(tall.box.scrollTop).toBe(50)
  })
})
