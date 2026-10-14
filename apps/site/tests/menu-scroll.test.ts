import { describe, expect, it } from 'vite-plus/test'

import { MENU_SCROLL_SLACK, scrolledAway } from '../src/shared/menuScroll'

/*
 * The open menu allows a short move of the page, then closes. The boundary
 * is the slack itself: that far stays open, and one pixel past closes,
 * either way.
 */

describe('scrolledAway', () => {
  const openedAt = 200

  it('stays open within the slack, either way', () => {
    expect(scrolledAway(openedAt, openedAt)).toBe(false)
    expect(scrolledAway(openedAt, openedAt + MENU_SCROLL_SLACK)).toBe(false)
    expect(scrolledAway(openedAt, openedAt - MENU_SCROLL_SLACK)).toBe(false)
  })

  it('closes once the page has moved past the slack, either way', () => {
    expect(scrolledAway(openedAt, openedAt + MENU_SCROLL_SLACK + 1)).toBe(true)
    expect(scrolledAway(openedAt, openedAt - MENU_SCROLL_SLACK - 1)).toBe(true)
  })
})
