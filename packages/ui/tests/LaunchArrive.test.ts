import { describe, expect, it, vi } from 'vitest'

import { arrive } from '../src/screens/Launch/Launch'
import { AT } from '../src/screens/Launch/timeline'

describe('what the launch opens onto, arriving', () => {
  it('starts every piece at the first beat where the page has no height yet to place them by', () => {
    const animate = vi.fn()
    const within = document.createElement('div')
    within.innerHTML = '<header data-arrive></header><ul data-arrive-each><li></li></ul>'
    for (const piece of within.querySelectorAll<HTMLElement>('header, li')) piece.animate = animate
    arrive(within)
    expect(animate).toHaveBeenCalledTimes(4)
    expect(animate.mock.calls.map(([, options]) => (options as KeyframeAnimationOptions).delay)).toEqual(
      Array(4).fill(AT.open.arrive.start),
    )
  })
})
