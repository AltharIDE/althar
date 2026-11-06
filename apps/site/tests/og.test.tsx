import { describe, expect, it } from 'vite-plus/test'

import { plate } from '../src/home/hero/plate'
import { bodiesAt, nameBox, placeNames, unnamed } from '../src/home/hero/system'
import { frameOf, MOMENT, ZOOM } from '../src/og/Card'

/** The card, and where its band's words begin, as the browser lays them out (`/og?page=home`): every card's headline is two lines. */
const CARD = { w: 1200, h: 630, foot: 421 }

describe('the link previews', () => {
  const p = plate(frameOf(CARD.w, CARD.h, CARD.foot))
  const at = bodiesAt(p, MOMENT)
  const names = unnamed(p)
  placeNames(p, at, names, MOMENT, 0)

  it('hold a moment when every agent is on the card, none behind the sun', () => {
    for (const b of at) {
      expect(b.x - b.size / 2).toBeGreaterThan(0)
      expect(b.x + b.size / 2).toBeLessThan(p.w)
      expect(b.y + b.size / 2).toBeLessThan(p.foot)
      if (b.d < 0) expect(Math.abs(b.x - p.cx)).toBeGreaterThan(p.sun / 2)
    }
  })

  it('name every agent, on the card, clear of the band', () => {
    names.forEach((n, i) => {
      expect(n.side).not.toBeNull()
      const box = nameBox(at[i]!, p.bodies[i]!.name, n.side!)
      expect(box.l).toBeGreaterThan(0)
      expect(box.r).toBeLessThan(p.w)
      expect(box.b).toBeLessThan(p.foot)
    })
  })

  it('draw the orrery larger than a laptop’s first screen does, so its sun carries at a feed’s size', () => {
    const laptop = plate({ w: 1280, h: 800, top: 104, foot: 511, phone: false })
    expect(p.sun * ZOOM).toBeGreaterThan(laptop.sun * 1.15)
  })
})
